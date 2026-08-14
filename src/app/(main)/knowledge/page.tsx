'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Library,
  Trash2,
  Loader2,
  ArrowLeft,
  Upload,
  FileText,
  Database,
  Cloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useT } from '@/lib/i18n';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  storage_type: 'database' | 'oss';
  created_at: string;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  oss_key: string | null;
  file_type: string;
  file_size: number;
  created_at: string;
}

export default function KnowledgePage() {
  const t = useT();
  const router = useRouter();

  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    storage_type: 'database' as 'database' | 'oss',
  });
  const [creating, setCreating] = useState(false);

  // 详情视图
  const [currentKb, setCurrentKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteForm, setPasteForm] = useState({ title: '', content: '' });
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocument | null>(null);

  const loadKbs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/knowledge-bases');
      const data = await res.json();
      if (Array.isArray(data)) setKbs(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKbs();
  }, [loadKbs]);

  const loadDocs = useCallback(async (kbId: string) => {
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/knowledge-bases/${kbId}/documents`);
      const data = await res.json();
      if (Array.isArray(data)) setDocs(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      toast.error('知识库名称不能为空');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name.trim(),
          description: createForm.description.trim() || undefined,
          storage_type: createForm.storage_type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`知识库「${data.name}」创建成功`);
        setCreateOpen(false);
        setCreateForm({ name: '', description: '', storage_type: 'database' });
        loadKbs();
      } else {
        toast.error(data?.error || '创建失败');
      }
    } catch {
      toast.error('创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openKb = async (kb: KnowledgeBase) => {
    setCurrentKb(kb);
    loadDocs(kb.id);
  };

  const handleDeleteKb = async (kb: KnowledgeBase) => {
    if (!confirm(`确定删除知识库「${kb.name}」吗？其下所有文档将一并删除。`)) return;
    try {
      const res = await fetch(`/api/knowledge-bases/${kb.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('已删除');
        if (currentKb?.id === kb.id) setCurrentKb(null);
        loadKbs();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  const uploadFile = async (file: File) => {
    if (!currentKb) return;
    setUploading(true);
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error('文件内容为空');
        return;
      }
      const res = await fetch(`/api/knowledge-bases/${currentKb.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name,
          content: text,
          file_type: file.name.endsWith('.md') ? 'md' : 'txt',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`已上传「${data.title}」`);
        loadDocs(currentKb.id);
      } else {
        toast.error(data?.error || '上传失败');
      }
    } catch {
      toast.error('上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async () => {
    if (!currentKb) return;
    if (!pasteForm.title.trim() || !pasteForm.content.trim()) {
      toast.error('标题和内容不能为空');
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/knowledge-bases/${currentKb.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pasteForm.title.trim(),
          content: pasteForm.content,
          file_type: 'paste',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`已添加「${data.title}」`);
        setPasteOpen(false);
        setPasteForm({ title: '', content: '' });
        loadDocs(currentKb.id);
      } else {
        toast.error(data?.error || '添加失败');
      }
    } catch {
      toast.error('添加失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async () => {
    if (!deleteTarget || !currentKb) return;
    try {
      const res = await fetch(
        `/api/knowledge-bases/${currentKb.id}/documents/${deleteTarget.id}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        toast.success('已删除');
        loadDocs(currentKb.id);
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  // ===== 详情视图 =====
  if (currentKb) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setCurrentKb(null)}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('common.back')}
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Library className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{currentKb.name}</h1>
              <p className="text-sm text-muted-foreground">
                {currentKb.description || '—'}
                {currentKb.storage_type === 'oss' && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    <Cloud className="mr-1 h-3 w-3" /> OSS
                  </Badge>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted ${
                uploading ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <Upload className="h-4 w-4" />
              {uploading ? t('common.loading') : t('knowledge.uploadFile')}
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <Button size="sm" onClick={() => setPasteOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('knowledge.pasteText')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-destructive"
              onClick={() => handleDeleteKb(currentKb)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('common.delete')}
            </Button>
          </div>
        </div>

        {/* 文档列表 */}
        <div className="flex-1 space-y-3 p-6">
          {docsLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.loading')}
            </p>
          )}
          {!docsLoading && docs.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('knowledge.noDocuments')}
            </p>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.content.length} 字 · {new Date(doc.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                onClick={() => setDeleteTarget(doc)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {/* 粘贴文本对话框 */}
        <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('knowledge.pasteText')}</DialogTitle>
              <DialogDescription>{t('knowledge.pasteHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('knowledge.docTitle')}</Label>
                <Input
                  value={pasteForm.title}
                  onChange={(e) => setPasteForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="如：产品介绍"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('knowledge.docContent')}</Label>
                <Textarea
                  value={pasteForm.content}
                  onChange={(e) => setPasteForm((f) => ({ ...f, content: e.target.value }))}
                  className="min-h-[160px]"
                  placeholder={t('knowledge.pastePlaceholder')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasteOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handlePaste} disabled={uploading}>
                {uploading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t('common.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 删除文档确认 */}
        <ConfirmDialog
          open={!!deleteTarget}
          destructive
          title={deleteTarget ? `确定删除文档「${deleteTarget.title}」吗？` : ''}
          onConfirm={handleDeleteDoc}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  // ===== 列表视图 =====
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Library className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('knowledge.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('knowledge.subtitle')}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('knowledge.createKb')}
        </Button>
      </div>

      <div className="flex-1 p-6">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </p>
        )}
        {!loading && kbs.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">{t('knowledge.noKbs')}</p>
            <Button className="mt-4" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('knowledge.createKb')}
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kbs.map((kb) => (
            <div
              key={kb.id}
              className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:border-primary/50"
              onClick={() => openKb(kb)}
            >
              <div className="flex items-start justify-between">
                <Library className="h-5 w-5 text-primary" />
                {kb.storage_type === 'oss' ? (
                  <Badge variant="outline" className="text-xs">
                    <Cloud className="mr-1 h-3 w-3" /> OSS
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    <Database className="mr-1 h-3 w-3" /> {t('knowledge.storageDb')}
                  </Badge>
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-foreground">{kb.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {kb.description || '—'}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(kb.created_at).toLocaleDateString('zh-CN')}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 创建知识库对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('knowledge.createKb')}</DialogTitle>
            <DialogDescription>{t('knowledge.createKbHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                {t('knowledge.kbName')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：产品文档"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('knowledge.kbDesc')}</Label>
              <Input
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('knowledge.kbDescPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('knowledge.storageType')}</Label>
              <RadioGroup
                value={createForm.storage_type}
                onValueChange={(v) =>
                  setCreateForm((f) => ({ ...f, storage_type: v as 'database' | 'oss' }))
                }
                className="grid gap-2"
              >
                <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                  <RadioGroupItem value="database" className="mt-0.5" />
                  <span>
                    <span className="flex items-center gap-1 font-medium">
                      <Database className="h-3.5 w-3.5" />
                      {t('knowledge.storageDb')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('knowledge.storageDbHint')}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                  <RadioGroupItem value="oss" className="mt-0.5" />
                  <span>
                    <span className="flex items-center gap-1 font-medium">
                      <Cloud className="h-3.5 w-3.5" />
                      {t('knowledge.storageOss')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('knowledge.storageOssHint')}
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
