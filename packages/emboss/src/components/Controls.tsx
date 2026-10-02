import type { ReactNode } from 'react';
import {
  Checkbox as RACCheckbox,
  Label,
  Radio as RACRadio,
  RadioGroup as RACRadioGroup,
  SelectionIndicator,
  Slider as RACSlider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Switch as RACSwitch,
  Tab as RACTab,
  TabList as RACTabList,
  TabPanel as RACTabPanel,
  Tabs as RACTabs,
  Text,
  type CheckboxProps as RACCheckboxProps,
  type RadioGroupProps as RACRadioGroupProps,
  type RadioProps,
  type SliderProps as RACSliderProps,
  type SwitchProps as RACSwitchProps,
  type TabListProps,
  type TabPanelProps,
  type TabProps,
  type TabsProps,
  composeRenderProps,
} from 'react-aria-components';
import { Icon } from '../icons/Icon';
import { cx } from '../utils';

/* ── Checkbox (kit 63:327) ─────────────────────────────────────────── */

export interface CheckboxProps extends Omit<RACCheckboxProps, 'children'> {
  children?: ReactNode;
}

/** A small box pressed into the paper; checking fills the well with ink. */
export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <RACCheckbox
      {...props}
      className={composeRenderProps(className, (cls) => cx('emb-check', cls))}
    >
      {({ isSelected, isIndeterminate }) => (
        <>
          <span className="emb-check__box" aria-hidden>
            {isIndeterminate ? (
              <Icon name="minus" size={14} />
            ) : (
              isSelected && <Icon name="check" size={14} />
            )}
          </span>
          {children && <span className="emb-check__label">{children}</span>}
        </>
      )}
    </RACCheckbox>
  );
}

/* ── Radio (kit 63:473) ────────────────────────────────────────────── */

export interface RadioGroupProps extends Omit<RACRadioGroupProps, 'children'> {
  label?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function RadioGroup({ label, description, children, className, ...props }: RadioGroupProps) {
  return (
    <RACRadioGroup
      {...props}
      className={composeRenderProps(className, (cls) => cx('emb-radio-group', cls))}
    >
      {label && <Label className="emb-field__label">{label}</Label>}
      {children}
      {description && (
        <Text slot="description" className="emb-field__helper">
          {description}
        </Text>
      )}
    </RACRadioGroup>
  );
}

/** Round debossed well; selecting drops in a raised ink bead that grows from the centre. */
export function Radio({ children, className, ...props }: RadioProps) {
  return (
    <RACRadio {...props} className={composeRenderProps(className, (cls) => cx('emb-radio', cls))}>
      {composeRenderProps(children, (content) => (
        <>
          <span className="emb-radio__well" aria-hidden>
            <span className="emb-radio__bead" />
          </span>
          <span className="emb-check__label">{content}</span>
        </>
      ))}
    </RACRadio>
  );
}

/* ── Switch (kit 63:562) ───────────────────────────────────────────── */

export interface SwitchProps extends Omit<RACSwitchProps, 'children'> {
  children?: ReactNode;
}

/** Debossed track with an embossed paper knob; On fills the track with ink. */
export function Switch({ children, className, ...props }: SwitchProps) {
  return (
    <RACSwitch {...props} className={composeRenderProps(className, (cls) => cx('emb-switch', cls))}>
      <span className="emb-switch__track" aria-hidden>
        <span className="emb-switch__knob" />
      </span>
      {children && <span className="emb-check__label">{children}</span>}
    </RACSwitch>
  );
}

/* ── Slider (kit 66:349) ───────────────────────────────────────────── */

export interface SliderProps extends RACSliderProps<number> {
  label?: ReactNode;
  /** Hide the label/value header (the label still names the thumb for AT). */
  hideHeader?: boolean;
}

/**
 * A groove pressed into the paper, inked up to the value, with an embossed knob.
 * While dragging, the knob sinks and a value slip appears above it.
 */
export function Slider({ label, hideHeader, className, ...props }: SliderProps) {
  return (
    <RACSlider {...props} className={composeRenderProps(className, (cls) => cx('emb-slider', cls))}>
      <div className={cx('emb-slider__header', hideHeader && 'emb-visually-hidden')}>
        {label && <Label className="emb-field__label">{label}</Label>}
        <SliderOutput className="emb-slider__output" />
      </div>
      <SliderTrack className="emb-slider__track">
        {({ state }) => (
          <>
            <span className="emb-slider__groove" />
            <span
              className="emb-slider__fill"
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
            <SliderThumb className="emb-slider__knob">
              <span className="emb-slider__slip" aria-hidden>
                {state.getThumbValueLabel(0)}
              </span>
            </SliderThumb>
          </>
        )}
      </SliderTrack>
    </RACSlider>
  );
}

/* ── Tabs (kit 66:422) ─────────────────────────────────────────────── */

export function Tabs(props: TabsProps) {
  return <RACTabs {...props} className={composeRenderProps(props.className, (c) => cx('emb-tabs', c))} />;
}

/** The tab list is a debossed rail; the active tab is a raised key that slides between positions. */
export function TabList<T extends object>(props: TabListProps<T>) {
  return <RACTabList {...props} className={composeRenderProps(props.className, (c) => cx('emb-tablist', c))} />;
}

export function Tab({ children, ...props }: TabProps) {
  return (
    <RACTab {...props} className={composeRenderProps(props.className, (c) => cx('emb-tab', c))}>
      {composeRenderProps(children, (content) => (
        <>
          <SelectionIndicator className="emb-tab__key" />
          <span className="emb-tab__label">{content}</span>
        </>
      ))}
    </RACTab>
  );
}

export function TabPanel(props: TabPanelProps) {
  return <RACTabPanel {...props} className={composeRenderProps(props.className, (c) => cx('emb-tabpanel', c))} />;
}
