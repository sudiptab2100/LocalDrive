import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

// ------------------------------------------------------------------ Toasts ---
type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {})

export function useToast(): (kind: ToastKind, message: string) => void {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = idRef.current++
      setItems((list) => [...list, { id, kind, message }])
      window.setTimeout(() => dismiss(id), 3200)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-host" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)} role="status">
            <span className="toast-dot" />
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ------------------------------------------------------------------- Modal ---
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Autofocus the first focusable field in the modal.
    const t = window.setTimeout(() => {
      const el = cardRef.current?.querySelector<HTMLElement>(
        'input, select, textarea, button:not(.modal-x)'
      )
      el?.focus()
    }, 20)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        style={width ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// --------------------------------------------------------------- Confirm ----
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: ReactNode
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element | null {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-message">{message}</p>
    </Modal>
  )
}

// ------------------------------------------------------------------ Switch ---
export function Switch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

// ------------------------------------------------------------------ Avatar ---
function hashHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}
function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }): JSX.Element {
  const hue = hashHue(name || '?')
  return (
    <span
      className={`avatar ${size}`}
      style={{
        background: `hsl(${hue} 55% 30%)`,
        borderColor: `hsl(${hue} 55% 45%)`,
        color: `hsl(${hue} 85% 85%)`
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

// -------------------------------------------------------------------- Menu ---
export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  title?: string
}
export function Menu({ items, label = '⋯' }: { items: MenuItem[]; label?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        className="btn icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- Password in ---
/** Password input with a show/hide toggle. */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  autoComplete?: string
}): JSX.Element {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-input">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
