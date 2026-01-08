import express from 'express';
import cors from 'cors';
import { PrismaClient } from './generated/prisma';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.member.findUnique({ where: { email } });
  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  res.json({ message: 'Login successful', user });
});

// Fetch all members
app.get('/members', async (_req, res) => {
  const members = await prisma.member.findMany();
  res.json(members);
});

app.listen(3000, '0.0.0.0', () => console.log('Backend running on port 3000'));
