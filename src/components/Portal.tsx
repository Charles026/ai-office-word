/**
 * Portal 组件
 * 
 * 将子元素渲染到 DOM 树的指定位置（默认 body）。
 * 用于解决 overflow: hidden 导致的下拉菜单被裁剪问题。
 */

import { useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  children: ReactNode;
  /** 渲染目标，默认为 document.body */
  container?: Element | null;
}

export const Portal: React.FC<PortalProps> = ({ children, container }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  const target = container || document.body;
  return createPortal(children, target);
};

export default Portal;

