import { forwardRef } from 'react';

// Field (DESIGN.md section 5). The global :focus-visible rule draws focus.
const NeuInput = forwardRef(function NeuInput({ className = '', as = 'input', ...props }, ref) {
  const Component = as;
  return (
    <Component
      ref={ref}
      className={`
        min-h-10 border border-strong bg-background px-3 py-2 text-base text-foreground
        placeholder:text-muted-foreground
        ${className}
      `}
      {...props}
    />
  );
});

export default NeuInput;
