/**
 * next/image shim — maps to regular <img> tag
 */
import type { ImgHTMLAttributes } from 'react';

interface NextImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
}

export default function Image({ src, alt, width, height, fill, priority, quality, placeholder, blurDataURL, unoptimized, style, className, ...props }: NextImageProps) {
  const imgStyle: React.CSSProperties = { ...style };
  if (fill) {
    imgStyle.position = 'absolute';
    imgStyle.height = '100%';
    imgStyle.width = '100%';
    imgStyle.left = 0;
    imgStyle.top = 0;
    imgStyle.right = 0;
    imgStyle.bottom = 0;
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={imgStyle}
      loading={priority ? 'eager' : 'lazy'}
      {...props}
    />
  );
}

export { Image };
