import type { ReactNode } from 'react';
import {
  Button as RACButton,
  FieldError,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField as RACNumberField,
  Popover,
  Select as RACSelect,
  SelectValue,
  Text,
  TextArea,
  TextField as RACTextField,
  type ListBoxItemProps,
  type NumberFieldProps as RACNumberFieldProps,
  type SelectProps as RACSelectProps,
  type TextFieldProps as RACTextFieldProps,
  type ValidationResult,
  composeRenderProps,
} from 'react-aria-components';
import { Icon, type IconName } from '../icons/Icon';
import { cx } from '../utils';

interface FieldChrome {
  label?: ReactNode;
  /** Helper below the well (Sans/Helper). */
  description?: ReactNode;
  errorMessage?: string | ((v: ValidationResult) => string);
}

export interface TextFieldProps extends RACTextFieldProps, FieldChrome {
  placeholder?: string;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  multiline?: boolean;
  rows?: number;
}

/**
 * Debossed well pressed into the paper (kit 59:186): the opposite of the raised
 * button, so inputs and actions read differently at a glance.
 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  leadingIcon,
  trailingIcon,
  multiline,
  rows = 4,
  className,
  ...props
}: TextFieldProps) {
  return (
    <RACTextField
      {...props}
      className={composeRenderProps(className, (cls) => cx('emb-field', cls))}
    >
      {label && <Label className="emb-field__label">{label}</Label>}
      <div className={cx('emb-well-input', multiline && 'emb-well-input--multiline')}>
        {leadingIcon && <Icon name={leadingIcon} size={18} />}
        {multiline ? (
          <TextArea placeholder={placeholder} rows={rows} className="emb-well-input__control" />
        ) : (
          <Input placeholder={placeholder} className="emb-well-input__control" />
        )}
        {trailingIcon && <Icon name={trailingIcon} size={18} />}
      </div>
      {description && (
        <Text slot="description" className="emb-field__helper">
          {description}
        </Text>
      )}
      <FieldError className="emb-field__error">{errorMessage}</FieldError>
    </RACTextField>
  );
}

export interface NumberFieldProps extends RACNumberFieldProps, FieldChrome {}

/** Debossed well with two small embossed stepper keys (kit 61:189). */
export function NumberField({ label, description, errorMessage, className, ...props }: NumberFieldProps) {
  return (
    <RACNumberField
      {...props}
      className={composeRenderProps(className, (cls) => cx('emb-field', cls))}
    >
      {label && <Label className="emb-field__label">{label}</Label>}
      <Group className="emb-well-input emb-well-input--number">
        <Input className="emb-well-input__control" />
        <RACButton slot="decrement" className="emb-stepper-key">
          <Icon name="minus" size={16} />
        </RACButton>
        <RACButton slot="increment" className="emb-stepper-key">
          <Icon name="plus" size={16} />
        </RACButton>
      </Group>
      {description && (
        <Text slot="description" className="emb-field__helper">
          {description}
        </Text>
      )}
      <FieldError className="emb-field__error">{errorMessage}</FieldError>
    </RACNumberField>
  );
}

export interface SelectProps<T extends object> extends Omit<RACSelectProps<T>, 'children'>, FieldChrome {
  items?: Iterable<T>;
  children: ReactNode | ((item: T) => ReactNode);
}

/**
 * Raised paper trigger that sinks into a deboss when open, with a floating paper
 * menu (kit 61:371). Chevron turns 180°, menu fades in (260 ms).
 */
export function Select<T extends object>({
  label,
  description,
  errorMessage,
  items,
  children,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <RACSelect
      {...props}
      className={composeRenderProps(className, (cls) => cx('emb-field', cls))}
    >
      {label && <Label className="emb-field__label">{label}</Label>}
      <RACButton className="emb-select-trigger">
        <SelectValue className="emb-select-trigger__value" />
        <Icon name="chevron-down" size={18} className="emb-select-trigger__chevron" />
      </RACButton>
      {description && (
        <Text slot="description" className="emb-field__helper">
          {description}
        </Text>
      )}
      <FieldError className="emb-field__error">{errorMessage}</FieldError>
      <Popover className="emb-menu-popover" offset={6}>
        <ListBox items={items} className="emb-menu">
          {children}
        </ListBox>
      </Popover>
    </RACSelect>
  );
}

export function SelectItem(props: ListBoxItemProps & { icon?: IconName }) {
  const { icon, children, ...rest } = props;
  const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <ListBoxItem
      {...rest}
      textValue={textValue}
      className={composeRenderProps(props.className, (cls) => cx('emb-menu-item', cls))}
    >
      {composeRenderProps(children, (content, { isSelected }) => (
        <>
          {icon && <Icon name={icon} size={18} />}
          <span className="emb-menu-item__label">{content}</span>
          {isSelected && <Icon name="check" size={16} className="emb-menu-item__check" />}
        </>
      ))}
    </ListBoxItem>
  );
}
