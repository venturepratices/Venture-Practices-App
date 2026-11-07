"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { createContactRequest } from "@/lib/sales/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ContactChoice, contactBody, ContactPicker } from "@/components/sales/contact-picker";

// "Add person" and "Add organization" (Mockup v2 `addPersonModal`, `addOrgModal`,
// Decision 19): the owner is always the person adding; the server's refusal
// message (Task 10's pinned strings) shows inline under the form. On success
// the dialog closes and the Contacts page opens the new contact's panel.

// --- Add person ---

const PHONE_MAX = 40;
const ROLE_MAX = 200;
const EMAIL_MAX = 254;
const NAME_MAX = 200;

type Created = (contact: { id: string; name: string }) => void;

export function NewPersonDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: Created;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={nameRef}>
        <NewPersonForm
          nameRef={nameRef}
          onCancel={() => onOpenChange(false)}
          onCreated={(contact) => {
            toast("Person added.");
            onCreated(contact);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewPersonForm({
  nameRef,
  onCancel,
  onCreated,
}: {
  nameRef: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onCreated: Created;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState<ContactChoice | null>(null);
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const body = {
      name: name.trim(),
      ...(role.trim() ? { role: role.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(organization ? { organization: contactBody(organization) } : {}),
    };
    const result = await createContactRequest("person", body);
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      if (!name.trim()) nameRef.current?.focus();
      return;
    }
    onCreated(result.data.contact);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add person</DialogTitle>
        <DialogDescription className="sr-only">
          Name is required. Email and phone show only on this person&apos;s page and their deals.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input
          ref={nameRef}
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Sarah K."
          maxLength={NAME_MAX}
          required
          autoComplete="off"
          aria-describedby={error ? errorId : undefined}
          className="pointer-coarse:h-10"
        />
      </div>

      <ContactPicker
        kind="organization"
        label="Organization"
        placeholder="Search or add a practice"
        value={organization}
        onChange={setOrganization}
      />

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-role`} className="text-xs text-muted-foreground">
          Role in practice
        </Label>
        <Input
          id={`${id}-role`}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="Office manager"
          maxLength={ROLE_MAX}
          autoComplete="off"
          className="pointer-coarse:h-10"
        />
      </div>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-email`} className="text-xs text-muted-foreground">
            Email
          </Label>
          <Input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={EMAIL_MAX}
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="pointer-coarse:h-10"
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-phone`} className="text-xs text-muted-foreground">
            Phone
          </Label>
          <Input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={PHONE_MAX}
            placeholder="(512) 555-0100"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="pointer-coarse:h-10"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        You will be the owner. Email and phone show only on this person&apos;s page and their deals.
      </p>

      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Add organization ---

const ADDRESS_MAX = 500;
const WEBSITE_MAX = 500;
const ZIP_MAX = 10;

export function NewOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: Created;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" initialFocus={nameRef}>
        <NewOrganizationForm
          nameRef={nameRef}
          onCancel={() => onOpenChange(false)}
          onCreated={(contact) => {
            toast("Organization added.");
            onCreated(contact);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewOrganizationForm({
  nameRef,
  onCancel,
  onCreated,
}: {
  nameRef: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onCreated: Created;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `${id}-error`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const body = {
      name: name.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(zip.trim() ? { zip: zip.trim() } : {}),
      ...(website.trim() ? { website: website.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    };
    const result = await createContactRequest("organization", body);
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      if (!name.trim()) nameRef.current?.focus();
      return;
    }
    onCreated(result.data.contact);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Add organization</DialogTitle>
        <DialogDescription className="sr-only">
          Name is required. You will be the owner of the new organization.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input
          ref={nameRef}
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Practice name"
          maxLength={NAME_MAX}
          required
          autoComplete="off"
          aria-describedby={error ? errorId : undefined}
          className="pointer-coarse:h-10"
        />
      </div>

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-phone`} className="text-xs text-muted-foreground">
            Phone
          </Label>
          <Input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={PHONE_MAX}
            placeholder="(512) 555-0100"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="pointer-coarse:h-10"
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-zip`} className="text-xs text-muted-foreground">
            ZIP
          </Label>
          <Input
            id={`${id}-zip`}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={ZIP_MAX}
            placeholder="78704"
            value={zip}
            onChange={(event) => setZip(event.target.value)}
            className="tabular-nums pointer-coarse:h-10"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-web`} className="text-xs text-muted-foreground">
          Website
        </Label>
        <Input
          id={`${id}-web`}
          type="url"
          inputMode="url"
          autoComplete="url"
          maxLength={WEBSITE_MAX}
          placeholder="https://"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          className="pointer-coarse:h-10"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-addr`} className="text-xs text-muted-foreground">
          Address
        </Label>
        <Input
          id={`${id}-addr`}
          autoComplete="street-address"
          maxLength={ADDRESS_MAX}
          placeholder="Street, city, state"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="pointer-coarse:h-10"
        />
      </div>

      <p className="text-xs text-muted-foreground">You will be the owner.</p>

      {error ? (
        <p id={errorId} role="alert" className="-mt-2 text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} className="pointer-coarse:min-h-10">
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="pointer-coarse:min-h-10">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
