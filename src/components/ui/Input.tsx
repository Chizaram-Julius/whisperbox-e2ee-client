import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function Input({ label, hint, className = "", ...props }: InputProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        className={`h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-signal focus:ring-2 focus:ring-teal-100 ${className}`}
        {...props}
      />
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
