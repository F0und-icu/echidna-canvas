import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useOutsideDismiss } from './useOutsideDismiss';

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export function OptionPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '选择…',
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);
  useOutsideDismiss(open, [root], () => setOpen(false));
  useEffect(() => {
    if (open) root.current?.querySelector('[role="listbox"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  useEffect(() => {
    if (open)
      root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  const choose = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
  };
  const expand = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  return (
    <div
      className="option-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className="picker-label" id={id + '-label'}>
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? id + '-' + active : undefined}
        disabled={disabled || !options.length}
        className="picker-trigger"
        onClick={() => (open ? setOpen(false) : expand())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              expand();
              return;
            }
            if (event.key === 'Enter' || event.key === ' ') choose(active);
            else
              setActive(
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                      options.length,
              );
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'Tab') setOpen(false);
        }}
      >
        {selected?.icon && <span className="picker-icon">{selected.icon}</span>}
        <span className="picker-copy">
          <strong>{selected?.label ?? placeholder}</strong>
          {selected?.description && <small>{selected.description}</small>}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-options" role="listbox" id={id} aria-labelledby={id + '-label'}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={id + '-' + index}
              key={option.value}
              aria-selected={option.value === value}
              data-active={index === active}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.icon && <span className="picker-icon">{option.icon}</span>}
              <span className="picker-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.value === value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
