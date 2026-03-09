"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export function OrgSettingsPanel() {
  const { org, user, isCloudMode } = useAuth();
  const [orgName, setOrgName] = useState("");
  const [orgNameSaving, setOrgNameSaving] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Determine current user's role
  const currentMember = members.find((m) => m.userId === user?.id);
  const isAdmin = currentMember?.role === "admin" || currentMember?.role === "owner";

  useEffect(() => {
    if (org) setOrgName(org.name);
  }, [org]);

  useEffect(() => {
    if (isCloudMode) loadData();
  }, [isCloudMode]);

  async function loadData() {
    setLoading(true);
    try {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch("/api/org/members", { cache: "no-store" }),
        fetch("/api/org/invitations", { cache: "no-store" }),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
      }
      if (invitationsRes.ok) {
        const data = await invitationsRes.json();
        setInvitations(data.invitations || []);
      }
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOrgName() {
    setOrgNameSaving(true);
    try {
      await fetch("/api/org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName }),
      });
    } catch {
      // Ignore
    } finally {
      setOrgNameSaving(false);
    }
  }

  async function handleChangeRole(userId: string, role: string) {
    await fetch(`/api/org/members/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    loadData();
  }

  async function handleRemoveMember(userId: string) {
    await fetch(`/api/org/members/${userId}`, { method: "DELETE" });
    loadData();
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteLoading(true);
    try {
      const res = await fetch("/api/org/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setInviteError(data?.error || "Failed to send invitation");
        return;
      }
      setInviteEmail("");
      setInviteOpen(false);
      loadData();
    } catch {
      setInviteError("Network error");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRevokeInvitation(id: string) {
    await fetch(`/api/org/invitations/${id}`, { method: "DELETE" });
    loadData();
  }

  if (!isCloudMode) {
    return null;
  }

  if (loading) {
    return <p className="text-[13px] text-muted-foreground">Loading organization...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Org Name */}
      <div className="space-y-2">
        <Label htmlFor="orgName">Organization Name</Label>
        <div className="flex gap-2">
          <Input
            id="orgName"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!isAdmin}
            className="text-[13px]"
          />
          {isAdmin && (
            <Button
              size="sm"
              onClick={handleSaveOrgName}
              disabled={orgNameSaving || orgName === org?.name}
            >
              {orgNameSaving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      {/* Members */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-medium">Members</h3>
          {isAdmin && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Invite Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Member</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleInvite} className="space-y-3">
                  {inviteError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                      {inviteError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="inviteEmail">Email</Label>
                    <Input
                      id="inviteEmail"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full" disabled={inviteLoading}>
                    {inviteLoading ? "Sending..." : "Send Invitation"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="space-y-1">
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-[13px]"
            >
              <div>
                <span className="font-medium">
                  {member.displayName || member.email}
                </span>
                {member.displayName && (
                  <span className="ml-2 text-muted-foreground">{member.email}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && member.userId !== user?.id ? (
                  <Select
                    value={member.role}
                    onValueChange={(role) => handleChangeRole(member.userId, role)}
                  >
                    <SelectTrigger className="h-7 w-24 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                      {currentMember?.role === "owner" && (
                        <>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                    {member.role}
                  </span>
                )}
                {isAdmin && member.userId !== user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => handleRemoveMember(member.userId)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Invitations */}
      {isAdmin && invitations.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-medium">Pending Invitations</h3>
          <div className="space-y-1">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-[13px]"
              >
                <div>
                  <span>{inv.email}</span>
                  <span className="ml-2 text-muted-foreground capitalize">
                    ({inv.role})
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                  onClick={() => handleRevokeInvitation(inv.id)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
