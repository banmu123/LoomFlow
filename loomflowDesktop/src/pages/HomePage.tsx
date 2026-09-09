/**
 * HomePage — 与 Web 端一致，重定向到 Chat
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/chat', { replace: true });
  }, [navigate]);
  return null;
}
