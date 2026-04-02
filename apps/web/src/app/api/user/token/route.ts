import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createHash, randomBytes } from 'crypto';

/**
 * Generate a CLI token for the authenticated user.
 * The token is a signed string containing the user ID + a random nonce.
 * It can be verified by the publish endpoint without storing it in the DB.
 */
export const POST = async () => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const nonce = randomBytes(16).toString('hex');
  const payload = `${session.user.id}:${nonce}:${Date.now()}`;
  const signature = createHash('sha256')
    .update(`${payload}:${secret}`)
    .digest('hex')
    .slice(0, 32);

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');

  return NextResponse.json({
    token,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
  });
};

/**
 * Verify a CLI token and return user info.
 * Used by the CLI's `whoami` command.
 */
export const GET = async (req: Request) => {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 401 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length < 4) throw new Error('Invalid token format');

    const userId = parts[0];
    const nonce = parts[1];
    const timestamp = parts[2];
    const sig = parts[3];

    // Verify signature
    const payload = `${userId}:${nonce}:${timestamp}`;
    const expected = createHash('sha256')
      .update(`${payload}:${secret}`)
      .digest('hex')
      .slice(0, 32);

    if (sig !== expected) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Token is valid — look up user
    const { prisma } = await import('@/lib/prisma');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true, username: true, role: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
};
