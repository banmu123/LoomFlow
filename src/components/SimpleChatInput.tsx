'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import { ArrowUp, Square, Paperclip, AtSign, X, Loader2, Mic } from 'lucide-react';

export interface SimpleChatInputProps {
  /** controlled value */
  value: string;
  onChange: (value: string) => void;
  /** submit callback */
  onSubmit: (text?: string) => void;
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
  /** 可选模型列表（来自模型配置） */
  modelOptions?: Array<{ value: string; label: string }>;
  /** 当前选中模型 */
  model?: string;
  /** 切换模型 */
  onModelChange?: (value: string) => void;
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
  modelOptions = [],
  model,
  onModelChange,
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

  // ===== 语音输入（浏览器原生 Web Speech API）=====
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const baselineRef = useRef('');
  const finalTextRef = useRef('');
  // 手动停止 vs 说完自动结束：手动停止只填输入框，自动结束则直接发送
  const manualStopRef = useRef(false);
  // AI 回复期间的语音输入暂存（回复结束后自动发送，避免连续说话丢句）
  const pendingVoiceRef = useRef('');

  // 语音暂存：isGenerating 结束（AI 回复完成）后自动补发
  useEffect(() => {
    if (!isGenerating && pendingVoiceRef.current) {
      const text = pendingVoiceRef.current;
      pendingVoiceRef.current = '';
      onSubmit(text);
    }
  }, [isGenerating, onSubmit]);

  const toggleListening = () => {
    if (listening) {
      manualStopRef.current = true;
      recognitionRef.current?.stop();
      return;
    }
    const SR =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) {
      toast.error(t('chat.voiceUnsupported'));
      return;
    }
    try {
      const rec = new (SR as new () => {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        start: () => void;
        stop: () => void;
        onresult: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
        onend: (() => void) | null;
      })();
      rec.lang = 'zh-CN';
      // 单次识别：说完停顿自动结束（onend 触发自动发送）；手动停止则不发送
      rec.continuous = false;
      rec.interimResults = true;
      baselineRef.current = value;
      finalTextRef.current = '';
      manualStopRef.current = false;
      rec.onresult = (e) => {
        const ev = e as {
          resultIndex: number;
          results: Array<Array<{ transcript: string }> & { isFinal: boolean }>;
        };
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalTextRef.current += t;
          else interim += t;
        }
        onChange(baselineRef.current + finalTextRef.current + interim);
      };
      rec.onerror = (e) => {
        setListening(false);
        const err = (e as { error?: string }).error;
        if (err === 'not-allowed') toast.error(t('chat.voicePermission'));
        else if (err === 'network') toast.error(t('chat.voiceNetwork'));
        else toast.error(t('chat.voiceError'));
      };
      rec.onend = () => {
        const final = finalTextRef.current;
        if (final) {
          const full = baselineRef.current + final;
          onChange(full);
          // 说完自动结束 → 直接发送；手动停止 → 只填输入框供确认
          if (!manualStopRef.current) {
            // AI 回复期间：暂存，回复结束后自动补发（不丢句）
            if (isGenerating) {
              pendingVoiceRef.current = full;
            } else {
              onSubmit(full);
            }
            // 连续聆听：发送后自动重启识别，用户可继续说下一句（再次点击麦克风才停止）
            try {
              rec.start();
              baselineRef.current = '';
              finalTextRef.current = '';
              return;
            } catch {
              // 重启失败则结束聆听
            }
          }
        }
        setListening(false);
        manualStopRef.current = false;
      };
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      toast.success(t('chat.voiceContinuousHint'));
    } catch {
      toast.error(t('chat.voiceError'));
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20">
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
            {/* 语音输入（浏览器原生 Web Speech API） */}
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${
                listening ? 'animate-pulse text-destructive' : 'text-muted-foreground'
              }`}
              onClick={toggleListening}
              title={listening ? t('chat.voiceStop') : t('chat.voiceInput')}
            >
              <Mic className="h-3.5 w-3.5" />
            </Button>
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
            {modelOptions.length > 0 && onModelChange && (
              <Select value={model} onValueChange={onModelChange}>
                <SelectTrigger className="h-6 w-[110px] text-[11px]">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
