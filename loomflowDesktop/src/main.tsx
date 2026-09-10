import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 注意：全局 toast 容器（<Toaster />）只在 App 内挂载一次。
// sonner 的 toast store 是模块级单例，挂载多个 <Toaster /> 会让同一条消息
// 在多个位置重复渲染（曾经 main.tsx 与 App.tsx 各挂了一个 → 每次弹两个提示）。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
