export const MAX_FILE_SIZE = 50 * 1024;
export const MAX_FILES_PER_SCAN = 25;
const PRIORITY_SEGMENTS = ['src/', 'backend/', 'frontend/', 'routes/', 'middleware/', 'auth/', 'config/', 'services/', 'api/'];
export const SCAN_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.sql',
]);
export const SCAN_FILENAMES = new Set(['dockerfile', 'docker-compose.yml', '.env.example', 'package.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', 'vendor']);
function shouldIncludeFile(path, size) {
    if (size !== undefined && size > MAX_FILE_SIZE)
        return false;
    const lower = path.toLowerCase();
    const parts = lower.split('/');
    if (parts.some((p) => SKIP_DIRS.has(p)))
        return false;
    const basename = parts[parts.length - 1];
    if (SCAN_FILENAMES.has(basename))
        return basename === 'package.json';
    if (basename === 'dockerfile')
        return true;
    const dot = lower.lastIndexOf('.');
    if (dot === -1)
        return false;
    return SCAN_EXTENSIONS.has(lower.slice(dot));
}
function priorityScore(path) {
    const lower = path.toLowerCase();
    for (let i = 0; i < PRIORITY_SEGMENTS.length; i++) {
        if (lower.includes(PRIORITY_SEGMENTS[i]))
            return PRIORITY_SEGMENTS.length - i;
    }
    return 0;
}
export function selectFilesForScan(entries) {
    const candidates = entries
        .filter((e) => e.type === 'blob' && shouldIncludeFile(e.path, e.size))
        .sort((a, b) => priorityScore(b.path) - priorityScore(a.path));
    const selected = [];
    const hasPackageJson = candidates.some((c) => c.path.toLowerCase() === 'package.json');
    for (const c of candidates) {
        if (c.path.toLowerCase() === 'package.json')
            continue;
        if (selected.length >= MAX_FILES_PER_SCAN)
            break;
        selected.push(c.path);
    }
    if (hasPackageJson && selected.length < MAX_FILES_PER_SCAN) {
        selected.unshift('package.json');
    }
    return selected.slice(0, MAX_FILES_PER_SCAN);
}
export function detectLanguage(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx'))
        return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx'))
        return 'javascript';
    if (lower.endsWith('.py'))
        return 'python';
    if (lower.endsWith('.go'))
        return 'go';
    if (lower.endsWith('.java'))
        return 'java';
    if (lower.endsWith('.sql'))
        return 'sql';
    if (lower === 'dockerfile')
        return 'dockerfile';
    if (lower.endsWith('docker-compose.yml'))
        return 'yaml';
    if (lower.endsWith('.env.example'))
        return 'env';
    if (lower.endsWith('package.json'))
        return 'json';
    return 'text';
}
