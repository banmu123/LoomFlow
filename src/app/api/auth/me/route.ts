import { cookies } from 'next/headers';
import { verifyJWT, COOKIE_NAME } from '@/lib/auth';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return Response.json({ authenticated: false });
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return Response.json({ authenticated: false });
  }

  return Response.json({
    authenticated: true,
    user: {
      id: payload.uid,
      username: payload.username,
      role: payload.role,
    },
  });
}
