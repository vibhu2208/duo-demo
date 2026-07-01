import { config } from '../config.js';
import { chatCompletion, chatCompletionJson, duoTaskCompletion } from '../lib/llm/index.js';
import { parseJsonFromLlm } from '../lib/json-utils.js';
const BATCH_CHAR_LIMIT = 12000;
const DUO_MAX_FILE_CHARS = 500;
const DUO_MAX_FILES = 6;
const SYSTEM_PROMPT = `You are an expert application security engineer performing static code review.
Analyze the provided source files for security vulnerabilities.

Focus on OWASP Top 10 issues including:
- SQL/command injection
- Cross-site scripting (XSS)
- Broken authentication and session management
- Hardcoded secrets, API keys, passwords
- Insecure cryptography
- Path traversal
- SSRF
- Misconfigured CORS, headers, or security settings
- Unsafe deserialization
- Logging of sensitive data
- Missing input validation

You MUST respond with a single valid JSON object only — no markdown, no code fences, no extra text:
{
  "findings": [
    {
      "filePath": "path/from/input",
      "lineStart": 1,
      "lineEnd": 5,
      "severity": "critical",
      "category": "injection",
      "title": "short title",
      "description": "what is wrong and why it matters",
      "recommendation": "specific fix",
      "codeSnippet": "relevant code lines",
      "confidence": 0.8
    }
  ],
  "summary": "one paragraph overall security assessment"
}

severity must be one of: critical, high, medium, low, info
category must be one of: injection, auth, secrets, crypto, xss, config, other

Only report real issues you can identify in the provided code. Do not invent file paths. If no issues found, return {"findings":[],"summary":"..."}.`;
const DUO_SYSTEM_PROMPT = `Security code reviewer. Output ONLY valid JSON, no markdown:
{"findings":[{"filePath":"path","severity":"high","category":"auth","title":"issue","description":"why","recommendation":"fix","confidence":0.8}],"summary":"brief assessment"}
If no issues: {"findings":[],"summary":"No issues found."}`;
function isDuoRefusal(raw) {
    return /i'?m sorry|can'?t generate|cannot generate|unable to (assist|help|respond)|please try again/i.test(raw);
}
function normalizeSeverity(value) {
    const s = String(value || 'medium').toLowerCase();
    if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low' || s === 'info')
        return s;
    return 'medium';
}
function normalizeFinding(raw, defaultPath) {
    const filePath = String(raw.filePath || raw.file_path || defaultPath || '');
    const title = String(raw.title || '');
    if (!filePath || !title)
        return null;
    return {
        filePath,
        lineStart: raw.lineStart != null ? Number(raw.lineStart) : raw.line_start != null ? Number(raw.line_start) : undefined,
        lineEnd: raw.lineEnd != null ? Number(raw.lineEnd) : raw.line_end != null ? Number(raw.line_end) : undefined,
        severity: normalizeSeverity(raw.severity),
        category: String(raw.category || 'other'),
        title,
        description: String(raw.description || ''),
        recommendation: String(raw.recommendation || ''),
        codeSnippet: raw.codeSnippet ? String(raw.codeSnippet) : raw.code_snippet ? String(raw.code_snippet) : undefined,
        confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.5)),
    };
}
function truncateForDuo(content, maxChars) {
    if (content.length <= maxChars)
        return content;
    const lines = content.split('\n');
    let out = '';
    for (const line of lines) {
        if (out.length + line.length + 1 > maxChars)
            break;
        out += (out ? '\n' : '') + line;
    }
    return `${out}\n\n/* ... truncated for review (${content.length - out.length} chars omitted) */`;
}
function patternFindingsForFile(file) {
    const findings = [];
    const lower = file.content.toLowerCase();
    if (/jwt_secret|dev-secret|change-me|api_token\s*=\s*['"][^'"]+['"]/i.test(file.content)) {
        findings.push({
            filePath: file.path,
            severity: 'high',
            category: 'secrets',
            title: 'Hardcoded or weak secret',
            description: 'Secrets in source code may be exposed via the repository.',
            recommendation: 'Use environment variables and rotate exposed credentials.',
            codeSnippet: file.content.split('\n').find((l) => /secret|token|password/i.test(l))?.slice(0, 100),
            confidence: 0.7,
        });
    }
    if (/rejectunauthorized:\s*false/i.test(file.content)) {
        findings.push({
            filePath: file.path,
            severity: 'medium',
            category: 'config',
            title: 'TLS verification disabled',
            description: 'Disabling certificate verification allows MITM attacks.',
            recommendation: 'Enable TLS verification in production.',
            confidence: 0.8,
        });
    }
    if (/eval\s*\(|child_process\.exec\s*\(/i.test(lower)) {
        findings.push({
            filePath: file.path,
            severity: 'high',
            category: 'injection',
            title: 'Dynamic code or shell execution',
            description: 'Executing dynamic code or shell commands can enable injection.',
            recommendation: 'Avoid eval/exec; validate and sanitize all inputs.',
            confidence: 0.65,
        });
    }
    return findings;
}
function mockSecurityReview(files, repo) {
    const findings = files.flatMap(patternFindingsForFile);
    return {
        findings,
        summary: findings.length > 0
            ? `Demo scan of ${repo}: found ${findings.length} pattern(s).`
            : `Demo scan of ${repo}: no obvious patterns matched.`,
    };
}
function dedupeFindings(findings) {
    const seen = new Set();
    const result = [];
    for (const f of findings) {
        const key = `${f.filePath}:${f.lineStart || 0}:${f.category}:${f.title}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(f);
    }
    return result;
}
function batchFiles(files, limit) {
    const batches = [];
    let current = [];
    let currentSize = 0;
    for (const file of files) {
        const size = file.content.length + file.path.length;
        if (current.length > 0 && currentSize + size > limit) {
            batches.push(current);
            current = [];
            currentSize = 0;
        }
        current.push(file);
        currentSize += size;
    }
    if (current.length > 0)
        batches.push(current);
    return batches;
}
async function callLlmForReview(systemPrompt, user) {
    if (config.provider === 'openai') {
        return chatCompletionJson(systemPrompt, user);
    }
    return chatCompletion(systemPrompt, user);
}
function findingsFromJson(json, defaultPath) {
    const rawFindings = Array.isArray(json.findings) ? json.findings : [];
    const findings = [];
    for (const item of rawFindings) {
        if (item && typeof item === 'object') {
            const normalized = normalizeFinding(item, defaultPath);
            if (normalized)
                findings.push(normalized);
        }
    }
    return findings;
}
function isManifestFile(path) {
    const base = path.toLowerCase().split('/').pop() || '';
    return base === 'package.json' || base === 'package-lock.json' || base.endsWith('.lock');
}
function findingsFromProse(prose, filePath) {
    const findings = [];
    const lines = prose.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        const bullet = line.replace(/^[-*•]\s*|\d+\.\s*/, '');
        if (bullet.length < 20)
            continue;
        if (/no (security )?issues|no vulnerabilities|looks good|lgtm/i.test(bullet))
            continue;
        const sevMatch = bullet.match(/\b(critical|high|medium|low)\b/i);
        findings.push({
            filePath,
            severity: sevMatch ? normalizeSeverity(sevMatch[1]) : 'medium',
            category: 'other',
            title: bullet.length > 100 ? `${bullet.slice(0, 97)}...` : bullet,
            description: bullet,
            recommendation: 'Review and address per GitLab Duo assessment.',
            confidence: 0.55,
        });
    }
    if (findings.length === 0 && prose.length > 60) {
        findings.push({
            filePath,
            severity: 'info',
            category: 'other',
            title: 'GitLab Duo security assessment',
            description: prose.slice(0, 2500),
            recommendation: 'See description for Duo analysis details.',
            confidence: 0.5,
        });
    }
    return findings.slice(0, 12);
}
async function reviewSingleFileWithDuo(file, _repo, _branch) {
    const snippet = truncateForDuo(file.content, DUO_MAX_FILE_CHARS);
    const userPrompt = [
        `Review this file for security issues. JSON only.`,
        `filePath in each finding must be: ${file.path}`,
        '',
        snippet,
    ].join('\n');
    let raw = null;
    try {
        raw = await duoTaskCompletion(DUO_SYSTEM_PROMPT, userPrompt, `security-review:${file.path}`, {
            securityMode: true,
            graphqlMaxAttempts: 55,
        });
    }
    catch (err) {
        console.warn(`[security/review] Duo JSON pass failed for ${file.path}:`, err instanceof Error ? err.message : err);
    }
    if (raw && !isDuoRefusal(raw)) {
        const json = parseJsonFromLlm(raw);
        if (json) {
            return {
                findings: findingsFromJson(json, file.path),
                summary: String(json.summary || ''),
                usedDuo: true,
            };
        }
        const proseFindings = findingsFromProse(raw, file.path);
        if (proseFindings.length > 0) {
            return {
                findings: proseFindings,
                summary: `GitLab Duo review for ${file.path} (natural language response).`,
                usedDuo: true,
            };
        }
    }
    // Chat-style prompt — same shape as Duo Chat (works on your instance)
    try {
        const nlPrompt = [
            `What security vulnerabilities or risks do you see in this source file (${file.path})?`,
            'List each issue as a bullet with severity (critical/high/medium/low).',
            '',
            snippet,
        ].join('\n');
        raw = await duoTaskCompletion('You are an application security engineer reviewing source code.', nlPrompt, `security-chat:${file.path}`, { graphqlMaxAttempts: 40 });
        if (raw && !isDuoRefusal(raw)) {
            const json = parseJsonFromLlm(raw);
            if (json) {
                return {
                    findings: findingsFromJson(json, file.path),
                    summary: String(json.summary || ''),
                    usedDuo: true,
                };
            }
            const proseFindings = findingsFromProse(raw, file.path);
            if (proseFindings.length > 0) {
                return {
                    findings: proseFindings,
                    summary: `GitLab Duo review for ${file.path}.`,
                    usedDuo: true,
                };
            }
        }
    }
    catch (err) {
        console.warn(`[security/review] Duo chat-style pass failed for ${file.path}:`, err instanceof Error ? err.message : err);
    }
    const fallback = patternFindingsForFile(file);
    console.warn(`[security/review] Using pattern fallback for ${file.path}`);
    return {
        findings: fallback,
        summary: fallback.length > 0
            ? `Pattern checks flagged ${fallback.length} item(s) in ${file.path}.`
            : `No issues flagged in ${file.path}. Duo did not respond — set GITLAB_PROJECT_ID in .env and restart ai-service.`,
        usedDuo: false,
    };
}
async function reviewWithDuo(files, repo, branch) {
    const toReview = files
        .filter((f) => !isManifestFile(f.path))
        .slice(0, DUO_MAX_FILES);
    const skipped = files.length - toReview.length;
    const allFindings = [];
    const summaries = [];
    let duoOk = 0;
    let duoFallback = 0;
    for (const file of toReview) {
        const result = await reviewSingleFileWithDuo(file, repo, branch);
        allFindings.push(...result.findings);
        if (result.summary)
            summaries.push(result.summary);
        if (result.usedDuo)
            duoOk++;
        else
            duoFallback++;
        await sleep(300);
    }
    const prefix = skipped > 0
        ? `Reviewed ${toReview.length} of ${files.length} files. `
        : `Reviewed ${toReview.length} files. `;
    const duoNote = duoFallback > 0 && duoOk === 0
        ? 'GitLab Duo did not respond for any file. Set GITLAB_PROJECT_ID in .env (numeric project ID from GitLab) and restart ai-service. '
        : duoFallback > 0
            ? `${duoOk} file(s) via Duo, ${duoFallback} via pattern fallback. `
            : `${duoOk} file(s) analyzed via GitLab Duo. `;
    return {
        findings: dedupeFindings(allFindings),
        summary: prefix + duoNote + (summaries.slice(0, 2).join(' ') || 'Review completed.'),
    };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function reviewBatch(files, repo, branch) {
    if (config.provider === 'mock') {
        return mockSecurityReview(files, repo);
    }
    if (config.provider === 'gitlab') {
        return reviewWithDuo(files, repo, branch);
    }
    const fileBlock = files
        .map((f) => `--- FILE: ${f.path} (${f.language}) ---\n${f.content}`)
        .join('\n\n');
    const user = `Repository: ${repo}\nBranch: ${branch}\n\nReview these files:\n\n${fileBlock}`;
    let raw = await callLlmForReview(SYSTEM_PROMPT, user);
    let json = parseJsonFromLlm(raw);
    if (!json) {
        const retryPrompt = `${SYSTEM_PROMPT}\n\nCRITICAL: Output ONLY raw JSON. No markdown. No \`\`\` fences. Start with { and end with }.`;
        raw = await callLlmForReview(retryPrompt, `${user}\n\nYour previous answer was not valid JSON. Try again with JSON only.`);
        json = parseJsonFromLlm(raw);
    }
    if (!json) {
        console.error('[security/review] Unparseable LLM response (first 500 chars):', raw.slice(0, 500));
        throw new Error('AI returned invalid JSON for security review.');
    }
    return {
        findings: findingsFromJson(json),
        summary: String(json.summary || ''),
    };
}
export async function reviewCode(payload) {
    if (payload.files.length === 0) {
        return { findings: [], summary: 'No files provided for review.' };
    }
    if (config.provider === 'gitlab') {
        return reviewWithDuo(payload.files, payload.repo, payload.branch);
    }
    const batches = batchFiles(payload.files, BATCH_CHAR_LIMIT);
    const allFindings = [];
    const summaries = [];
    for (const batch of batches) {
        const result = await reviewBatch(batch, payload.repo, payload.branch);
        allFindings.push(...result.findings);
        if (result.summary)
            summaries.push(result.summary);
    }
    return {
        findings: dedupeFindings(allFindings),
        summary: summaries.join(' ') || 'Review completed.',
    };
}
