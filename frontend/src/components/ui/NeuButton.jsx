export default function NeuButton({ children, className = '', active = false, disabled = false, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        rounded-input px-4 py-2 text-text-primary font-medium
        transition-shadow duration-150
        ${active ? 'shadow-neu-pressed' : 'shadow-neu-sm hover:shadow-neu active:shadow-neu-pressed'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
