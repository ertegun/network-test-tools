// Material Tailwind bileşenleri için ince sarmalayıcılar. Kütüphane değişirse yalnızca bu
// dosya güncellenir. (Material Tailwind 2.x tipleri React 18.3 tipleriyle uyumsuz
// zorunlu alanlar istediği için bileşenler burada kendi prop tiplerimize bağlanır.)

import * as MT from '@material-tailwind/react';
import { Icon as IconifyIcon, type IconifyIcon as IconData } from '@iconify/react/offline';
import type { ComponentType, ReactNode } from 'react';

type Color = 'blue' | 'gray' | 'green' | 'red' | 'amber' | 'blue-gray' | 'deep-orange';

function loose<P>(c: unknown): ComponentType<P> {
  return c as ComponentType<P>;
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'filled' | 'outlined' | 'gradient' | 'text';
  color?: Color;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}

const MTButton = loose<ButtonProps>(MT.Button);
export function Button({ type = 'button', className = '', ...p }: ButtonProps) {
  return <MTButton type={type} className={`flex items-center justify-center gap-2 normal-case ${className}`} {...p} />;
}

interface IconButtonProps {
  icon: IconData;
  label: string;
  onClick?: () => void;
  variant?: 'filled' | 'outlined' | 'text';
  color?: Color;
  disabled?: boolean;
  className?: string;
}

const MTIconButton = loose<Omit<IconButtonProps, 'icon' | 'label'> & { children: ReactNode; 'aria-label': string; title: string; size?: string }>(MT.IconButton);
export function IconButton({ icon, label, variant = 'text', className = '', ...p }: IconButtonProps) {
  return (
    <MTIconButton aria-label={label} title={label} variant={variant} size="sm" className={`dark:text-gray-200 ${className}`} {...p}>
      <Icon icon={icon} className="h-5 w-5" />
    </MTIconButton>
  );
}

const MTCard = loose<{ children: ReactNode; className?: string; shadow?: boolean }>(MT.Card);
const MTCardBody = loose<{ children: ReactNode; className?: string }>(MT.CardBody);
export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <MTCard shadow={false} className={`border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${className}`}>
      <MTCardBody className="p-4">
        {(title || actions) && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            <div className="flex items-center gap-1">{actions}</div>
          </div>
        )}
        {children}
      </MTCardBody>
    </MTCard>
  );
}

interface InputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  type?: string;
  className?: string;
}

const MTInput = loose<{
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  error?: boolean;
  disabled?: boolean;
  type?: string;
  className?: string;
  labelProps?: { className?: string };
  containerProps?: { className?: string };
  crossOrigin?: undefined;
}>(MT.Input);
export function Input({ onChange, className = '', ...p }: InputProps) {
  return (
    <MTInput
      {...p}
      onChange={(e) => onChange(e.target.value)}
      className={`dark:text-gray-100 ${className}`}
      labelProps={{ className: 'dark:!text-gray-400' }}
      containerProps={{ className: 'min-w-0' }}
    />
  );
}

/** Material Tailwind Select'in bilinen sorunları nedeniyle yerel select, aynı görünümle. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
      {label}
      <select
        className="h-10 rounded-md border border-gray-300 bg-transparent px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const MTChip = loose<{ value: ReactNode; color?: Color; variant?: 'filled' | 'ghost' | 'outlined'; size?: 'sm' | 'md'; className?: string }>(MT.Chip);
export function Chip({ value, color = 'gray', variant = 'ghost', className = '' }: { value: ReactNode; color?: Color; variant?: 'filled' | 'ghost' | 'outlined'; className?: string }) {
  // Ghost çipler koyu temada da okunaklı olsun.
  const dark = variant === 'ghost' ? 'dark:!text-gray-100' : '';
  return <MTChip value={value} color={color} variant={variant} size="sm" className={`w-fit normal-case ${dark} ${className}`} />;
}

const MTAlert = loose<{ children: ReactNode; color?: Color; icon?: ReactNode; className?: string; variant?: 'filled' | 'ghost' | 'outlined' }>(MT.Alert);
export function Alert({ children, color = 'blue', icon, className = '' }: { children: ReactNode; color?: Color; icon?: IconData; className?: string }) {
  return (
    <MTAlert variant="ghost" color={color} icon={icon ? <Icon icon={icon} className="h-5 w-5" /> : undefined} className={`py-2 text-sm ${className}`}>
      {children}
    </MTAlert>
  );
}

const MTSwitch = loose<{ checked: boolean; onChange: () => void; label?: ReactNode; disabled?: boolean; crossOrigin?: undefined; labelProps?: { className?: string } }>(MT.Switch);
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return <MTSwitch checked={checked} onChange={() => onChange(!checked)} label={label} disabled={disabled} labelProps={{ className: 'text-sm dark:text-gray-200' }} />;
}

const MTProgress = loose<{ value: number; size?: 'sm' | 'md'; className?: string }>(MT.Progress);
export function Progress({ value }: { value: number }) {
  return <MTProgress value={Math.max(0, Math.min(100, value))} size="sm" />;
}

const MTDialog = loose<{ open: boolean; handler: () => void; children: ReactNode; size?: 'sm' | 'md'; className?: string; dismiss?: { outsidePress?: boolean; escapeKey?: boolean } }>(MT.Dialog);
const MTDialogHeader = loose<{ children: ReactNode; className?: string }>(MT.DialogHeader);
const MTDialogBody = loose<{ children: ReactNode; className?: string }>(MT.DialogBody);
const MTDialogFooter = loose<{ children: ReactNode; className?: string }>(MT.DialogFooter);
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  dismissible?: boolean;
}) {
  return (
    <MTDialog open={open} handler={dismissible ? onClose : () => undefined} size="md" dismiss={{ outsidePress: dismissible, escapeKey: dismissible }} className="dark:bg-gray-800">
      <MTDialogHeader className="text-lg dark:text-gray-100">{title}</MTDialogHeader>
      <MTDialogBody className="text-sm text-gray-700 dark:text-gray-300">{children}</MTDialogBody>
      <MTDialogFooter className="gap-2">{footer}</MTDialogFooter>
    </MTDialog>
  );
}

export function Icon({ icon, className = 'h-5 w-5' }: { icon: IconData; className?: string }) {
  return <IconifyIcon icon={icon} className={className} />;
}

/** Teknik terimlerin yanında kısa açıklama. */
export function InfoTip({ text, icon }: { text: string; icon: IconData }) {
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help align-middle text-gray-500 dark:text-gray-400">
      <Icon icon={icon} className="h-4 w-4" />
    </span>
  );
}

export function Field({ label, children, info }: { label: string; children: ReactNode; info?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {label}
        {info}
      </span>
      <span className="break-all font-mono text-sm text-gray-900 dark:text-gray-100">{children}</span>
    </div>
  );
}
