'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface UserRecord {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  chat_quota: number;
  chat_used: number;
  status: string;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

function isLocked(u: UserRecord): boolean {
  return !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();
}

const EMPTY_FORM = {
  username: '',
  password: '',
  display_name: '',
  role: 'user',
  chat_quota: '10',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function AdminUsersPage() {
  const t = useT();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);

  // 编辑对话框
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    display_name: '',
    role: 'user',
    chat_quota: '10',
    status: 'active',
    password: '',
  });
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 401 || res.status === 403) {
        toast.error('无权限访问');
        setUsers([]);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async () => {
    if (!createForm.username.trim() || !createForm.password) {
      toast.error('用户名和密码不能为空');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          password: createForm.password,
          display_name: createForm.display_name.trim() || undefined,
          role: createForm.role,
          chat_quota: Number(createForm.chat_quota),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`用户 ${data.username} 创建成功`);
        setCreateOpen(false);
        setCreateForm({ ...EMPTY_FORM });
        loadUsers();
      } else {
        toast.error(data?.error || '创建失败');
      }
    } catch {
      toast.error('创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u: UserRecord) => {
    setEditTarget(u);
    setEditForm({
      display_name: u.display_name || '',
      role: u.role,
      chat_quota: String(u.chat_quota),
      status: u.status,
      password: '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editForm.display_name.trim() || undefined,
          role: editForm.role,
          chat_quota: Number(editForm.chat_quota),
          status: editForm.status,
          password: editForm.password || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('用户信息已更新');
        setEditTarget(null);
        loadUsers();
      } else {
        toast.error(data?.error || '更新失败');
      }
    } catch {
      toast.error('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlock = async (u: UserRecord) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlock: true }),
      });
      if (res.ok) {
        toast.success(`${u.username} 已解锁`);
        loadUsers();
      } else {
        toast.error('解锁失败');
      }
    } catch {
      toast.error('解锁失败');
    } finally {
      setSaving(false);
    }
  };

  const handleResetUsed = async (u: UserRecord) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_used: 0 }),
      });
      if (res.ok) {
        toast.success(`${u.username} 的已用次数已重置`);
        loadUsers();
      } else {
        toast.error('重置失败');
      }
    } catch {
      toast.error('重置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: UserRecord) => {
    if (!confirm(`确定要删除用户「${u.username}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`用户 ${u.username} 已删除`);
        loadUsers();
      } else {
        toast.error(data?.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('admin.users')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('admin.createUserDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('admin.createUser')}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.username')}</TableHead>
              <TableHead>{t('admin.displayName')}</TableHead>
              <TableHead>{t('admin.role')}</TableHead>
              <TableHead>{t('admin.chatQuota')}</TableHead>
              <TableHead>{t('admin.status')}</TableHead>
              <TableHead>{t('admin.createdAt')}</TableHead>
              <TableHead className="text-right">{t('workflows.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            )}
            {!loading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t('admin.noUsers')}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>{u.display_name || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? t('admin.admin') : t('admin.user')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.chat_quota === -1 ? (
                      <span className="text-muted-foreground">{t('admin.unlimited')}</span>
                    ) : (
                      <span className={u.chat_used >= u.chat_quota ? 'text-destructive' : ''}>
                        {u.chat_used} / {u.chat_quota}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={u.status === 'active' ? 'outline' : 'destructive'}
                        className={
                          u.status === 'active' ? 'text-green-600' : undefined
                        }
                      >
                        {u.status === 'active' ? t('admin.active') : t('admin.disabled')}
                      </Badge>
                      {isLocked(u) && (
                        <Badge variant="destructive">{t('admin.locked')}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTime(u.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {isLocked(u) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleUnlock(u)}
                          disabled={saving}
                          title="解除登录锁定"
                        >
                          {t('admin.unlock')}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)} title={t('common.edit')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {u.chat_quota !== -1 && u.chat_used > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleResetUsed(u)}
                          disabled={saving}
                          title="重置已用次数"
                        >
                          {t('admin.resetUsed')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => handleDelete(u)}
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {/* === {t('admin.createUser')}对话框 === */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.createUser')}</DialogTitle>
            <DialogDescription>{t('admin.createUserDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('admin.username')} *</Label>
              <Input
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="登录{t('admin.username')}"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.password')} *</Label>
              <PasswordInput
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="至少 6 位"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.displayName')}</Label>
              <Input
                value={createForm.display_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="选填，默认同{t('admin.username')}"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('admin.role')}</Label>
                <Select
                  value={createForm.role}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t('admin.user')}</SelectItem>
                    <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.quotaLabel')}</Label>
                <Input
                  type="number"
                  value={createForm.chat_quota}
                  onChange={(e) => setCreateForm((f) => ({ ...f, chat_quota: e.target.value }))}
                  placeholder="-1 {t('admin.unlimited')}"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === {t('common.edit')}用户对话框 === */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.edit')}用户：{editTarget?.username}</DialogTitle>
            <DialogDescription>修改{t('admin.role')}、配额、{t('admin.status')}或{t('admin.resetPassword')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('admin.displayName')}</Label>
              <Input
                value={editForm.display_name}
                onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('admin.role')}</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t('admin.user')}</SelectItem>
                    <SelectItem value="admin">{t('admin.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.quotaLabel')}（-1 {t('admin.unlimited')}）</Label>
                <Input
                  type="number"
                  value={editForm.chat_quota}
                  onChange={(e) => setEditForm((f) => ({ ...f, chat_quota: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>账号{t('admin.status')}</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('admin.active')}</SelectItem>
                    <SelectItem value="disabled">禁用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.resetPassword')}</Label>
                <PasswordInput
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={t('admin.passwordPlaceholder')}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
