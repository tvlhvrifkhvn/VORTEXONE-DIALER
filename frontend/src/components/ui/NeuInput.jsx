import { forwardRef } from 'react';

const NeuInput = forwardRef(function NeuInput({ className = '', as = 'input', ...props }, ref) {
  const Component = as;
  return (
    <Component
      ref={ref}
      className={`
        bg-surface rounded-input shadow-neu-inset px-3 py-2 text-text-primary
        placeholder:text-text-secondary outline-none
        focus:ring-2 focus:ring-action-call/40
        ${className}
      `}
      {...props}
    />
  );
});

export default NeuInput;
