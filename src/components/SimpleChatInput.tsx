'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { ArrowUp, Square, Paperclip, AtSign, X, Loader2 } from 'lucide-react';

export interface SimpleChatInputProps {
  /** controlled value */
  value: string;
  onChange: (value: string) => void;
  /** submit callback */
  onSubmit: () => void;
  /** is AI generating now */
  isGenerating: boolean;
  /** stop generation */
  onStop?: () => void;
  placeholder?: string;
  maxLength?: number;
  /** 已附带的图片 URL 列表 */
  images?: Array<{ url: string; name: string }>;
  /** 移除图片 */
  onRemoveImage?: (url: string) => void;
  /** 选择文件上传 */
  onAttachImage?: (file: File) => void;
  /** 是否有图片上传中 */
  uploading?: boolean;
}

const MAX_HEIGHT = 120;

export function SimpleChatInput({
  value,
  onChange,
  onSubmit,
  isGenerating,
  onStop,
  placeholder,
  maxLength = 4000,
  images = [],
  onRemoveImage,
  onAttachImage,
  uploading = false,
}: SimpleChatInputProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  // auto-resize
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
    setShowPlaceholder(value.length === 0);
  }, [value, resizeTextarea]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleSubmit = () => {
    if (isGenerating) {
      onStop?.();
      return;
    }
    if (value.trim()) {
      onSubmit();
    }
  };

  const canSend = value.trim().length > 0 && !isGenerating;

  return (
    <div className="border-t border-border bg-background p-3">
      <div className="flex flex-col rounded-lg border border-border bg-background focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
        {/* 图片预览区 */}
        {(images.length > 0 || uploading) && (
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
            {images.map((img) => (
              <div key={img.url} className="group relative">
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow-sm hover:text-destructive"
                  onClick={() => onRemoveImage?.(img.url)}
                  title={t('common.delete')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
        {/* textarea */}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t('chat.inputPlaceholder')}
          className="min-h-[36px] flex-1 resize-none border-0 bg-transparent px-3 pt-2.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
        />

        {/* bottom bar */}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0.5">
            <label className="inline-flex">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                asChild
                title={t('chat.addImage')}
              >
                <span>
                  <Paperclip className="h-3.5 w-3.5" />
                </span>
              </Button>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAttachImage?.(file);
                  e.target.value = '';
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => {
                // placeholder for mention
              }}
              title={t('chat.mention')}
            >
              <AtSign className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {showPlaceholder && value.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                {t('chat.enterToSend')}
              </span>
            )}
            {value.length > maxLength * 0.8 && (
              <span
                className={cn(
                  'text-[11px]',
                  value.length >= maxLength
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {value.length}/{maxLength}
              </span>
            )}
            <Button
              size="icon"
              className="h-7 w-7"
              onClick={handleSubmit}
              disabled={!isGenerating && !canSend}
              variant={isGenerating ? 'destructive' : 'default'}
            >
              {isGenerating ? (
                <Square className="h-3 w-3 fill-current" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
