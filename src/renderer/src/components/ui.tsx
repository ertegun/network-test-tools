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
      // Kütüphanenin min-w-[200px] sınıfı birleştirilmeden eklendiği için önemli (!) işareti gerekli;
      // yoksa dar alanda kutu taşar.
      containerProps={{ className: '!min-w-0' }}
    />
  );
}

/** Material Tailwind Select'in bilinen sorunları nedeniyle yerel select, aynı görünümle.
 *  `outlined`: etiket Input'taki gibi çerçevenin üst kenarında durur (kutu yüksekliği Input'la aynı). */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  outlined = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  outlined?: boolean;
}) {
  const optionList = options.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));
  if (outlined) {
    // Sınıflar Material Tailwind'in outlined Input'undan alındı: üst kenar şeffaf, etiketin iki
    // yanındaki çizgiler before/after ile çizilir; böylece arka plan renginden bağımsızdır.
    return (
      <div className="relative h-10 w-full min-w-0">
        <select
          className="peer h-full w-full rounded-[7px] border border-blue-gray-200 border-t-transparent bg-transparent px-3 py-2.5 text-sm text-blue-gray-700 outline outline-0 transition-all focus:border-2 focus:border-gray-900 focus:border-t-transparent focus:outline-0 disabled:border-0 disabled:bg-blue-gray-50 dark:bg-gray-800 dark:text-gray-100"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {optionList}
        </select>
        <label className="pointer-events-none absolute -top-1.5 left-0 flex h-full w-full select-none truncate text-[11px] font-normal leading-tight text-gray-500 !overflow-visible transition-all before:pointer-events-none before:mr-1 before:mt-[6.5px] before:box-border before:block before:h-1.5 before:w-2.5 before:rounded-tl-md before:border-l before:border-t before:border-blue-gray-200 before:transition-all after:pointer-events-none after:ml-1 after:mt-[6.5px] after:box-border after:block after:h-1.5 after:w-2.5 after:flex-grow after:rounded-tr-md after:border-r after:border-t after:border-blue-gray-200 after:transition-all peer-focus:text-gray-900 peer-focus:before:border-l-2 peer-focus:before:border-t-2 peer-focus:before:!border-gray-900 peer-focus:after:border-r-2 peer-focus:after:border-t-2 peer-focus:after:!border-gray-900 peer-disabled:before:border-transparent peer-disabled:after:border-transparent dark:!text-gray-400">
          {label}
        </label>
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
      {label}
      <select
        className="h-10 rounded-md border border-gray-300 bg-transparent px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {optionList}
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
