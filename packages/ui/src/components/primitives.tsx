import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* Presentational primitives. No business logic; every component is keyboard-operable by construction. */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "danger";
  readonly size?: "md" | "sm";
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = ["az-btn", `az-btn-${variant}`, size === "sm" ? "az-btn-sm" : "", className ?? ""]
    .join(" ")
    .trim();
  return <button type={type} className={cls} {...rest} />;
}

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="az-field">
      <label className="az-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <div className="az-field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="az-field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={["az-input", className ?? ""].join(" ").trim()} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={["az-select", className ?? ""].join(" ").trim()} {...rest} />;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label: string;
}

export function Checkbox({ label, id, ...rest }: CheckboxProps) {
  return (
    <label className="az-checkbox" htmlFor={id}>
      <input type="checkbox" id={id} {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface BannerProps {
  readonly tone: "info" | "warning" | "danger" | "success";
  readonly children: ReactNode;
}

const TONE_ICON = { info: "i", warning: "!", danger: "×", success: "✓" } as const;

export function Banner({ tone, children }: BannerProps) {
  return (
    <div className={`az-banner az-banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="az-banner-icon" aria-hidden="true">
        {TONE_ICON[tone]}
      </span>
      <div>{children}</div>
    </div>
  );
}

export interface CardProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
}

export function Card({ title, description, children }: CardProps) {
  return (
    <section className="az-card" aria-labelledby={slug(title)}>
      <div>
        <h2 className="az-card-title" id={slug(title)}>
          {title}
        </h2>
        {description ? <p className="az-card-desc">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { readonly children: ReactNode }) {
  return <div className="az-empty">{children}</div>;
}

export function Tag({ children }: { readonly children: ReactNode }) {
  return <span className="az-tag">{children}</span>;
}

function slug(s: string): string {
  return `h-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={["az-input", "az-textarea", className ?? ""].join(" ").trim()} {...rest} />;
}
