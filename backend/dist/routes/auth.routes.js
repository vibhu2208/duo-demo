import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
const router = Router();
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(2),
});
router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [parsed.data.email]);
    const user = rows[0];
    if (!user)
        return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!valid)
        return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
});
router.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const hash = await bcrypt.hash(parsed.data.password, 10);
    try {
        const { rows } = await query(`INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING id, email, name, role`, [parsed.data.email, hash, parsed.data.name]);
        const user = rows[0];
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
        res.status(201).json({ token, user });
    }
    catch {
        res.status(409).json({ error: 'Email already registered' });
    }
});
router.get('/me', authMiddleware, async (req, res) => {
    res.json({ user: req.user });
});
export default router;
