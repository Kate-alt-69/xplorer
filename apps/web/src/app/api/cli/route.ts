import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { randomBytes, createHash } from 'crypto';

/**
 * POST /api/cli — Generate a new CLI token (requires web session).
 * Stores the token hash in the DB so it persists across deploys.
 */
export const POST = async () => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = randomBytes(32).toString('base64url');
  const token = `xplorer_${raw}`;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { cliToken: createHash('sha256').update(token).digest('hex') },
  });

  return NextResponse.json({
    token,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
  });
};

/**
 * GET /api/cli — Verify a CLI token.
 */
export const GET = async (req: Request) => {
  const user = await verifyCliToken(req);
  if (!user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
  return NextResponse.json(user);
};

/**
 * DELETE /api/cli — Revoke CLI token (requires web session).
 */
export const DELETE = async () => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { cliToken: null },
  });

  return NextResponse.json({ revoked: true });
};

/**
 * Verify a Bearer token from the CLI.
 */
export const verifyCliToken = async (req: Request) => {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;

  const hash = createHash('sha256').update(token).digest('hex');
  const user = await prisma.user.findFirst({
    where: { cliToken: hash },
    select: { id: true, name: true, email: true, username: true, role: true },
  });

  return user || null;
};
