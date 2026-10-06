import type { CSSProperties, ReactNode } from 'react';
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
  /** Ink from this value instead of the start (centre-zero controls: 0). */
  origin?: number;
  /** Double-click resets to this value (and fires `onChangeEnd`). */
  resetValue?: number;
  /** Text of the value (header and slip), e.g. fr-CA « +0,35 ». */
  valueLabel?: (value: number) => string;
  /** Paint the groove (temperature, tint, hue ramps); no ink is drawn over it. */
  trackStyle?: CSSProperties;
  /** `sm`: the dense rows of tool panels (image atelier). */
  size?: 'md' | 'sm';
}

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

/**
 * A groove pressed into the paper, inked up to the value, with an embossed knob.
 * While dragging, the knob sinks and a value slip appears above it.
 * Arrows move one step, Maj + arrows ten.
 */
export function Slider({ label, hideHeader, className, origin, resetValue, valueLabel, trackStyle, size = 'md', ...props }: SliderProps) {
  const step = props.step ?? 1;
  return (
    <RACSlider {...props} className={composeRenderProps(className, (cls) => cx('emb-slider', size === 'sm' && 'emb-slider--sm', cls))}>
      {({ state }) => {
        const value = state.getThumbValue(0);
        const text = valueLabel ? valueLabel(value) : state.getThumbValueLabel(0);
        const set = (v: number) => {
          state.setThumbValue(0, v);
          props.onChangeEnd?.(state.getThumbValue(0));
        };
        const lo = state.getThumbMinValue(0);
        const hi = state.getThumbMaxValue(0);
        const from = origin === undefined ? 0 : state.getValuePercent(Math.min(Math.max(origin, lo), hi));
        const at = state.getThumbPercent(0);
        return (
          <>
            <div className={cx('emb-slider__header', hideHeader && 'emb-visually-hidden')}>
              {label && <Label className="emb-field__label">{label}</Label>}
              {valueLabel ? <output className="emb-slider__output">{text}</output> : <SliderOutput className="emb-slider__output" />}
            </div>
            {/* Maj + arrows: caught before the thumb's own one-step handling. */}
            <div
              className="emb-slider__keys"
              onKeyDownCapture={(e) => {
                const dir = ARROWS[e.key];
                if (!e.shiftKey || !dir || state.isDisabled) return;
                e.preventDefault();
                e.stopPropagation();
                set(value + dir * step * 10);
              }}
            >
              <SliderTrack className="emb-slider__track" onDoubleClick={resetValue === undefined || state.isDisabled ? undefined : () => set(resetValue)}>
                <span className="emb-slider__groove" style={trackStyle} />
                {!trackStyle && <span className="emb-slider__fill" style={{ left: `${Math.min(from, at) * 100}%`, width: `${Math.abs(at - from) * 100}%` }} />}
                <SliderThumb className="emb-slider__knob">
                  <span className="emb-slider__slip" aria-hidden>
                    {text}
                  </span>
                </SliderThumb>
              </SliderTrack>
            </div>
          </>
        );
      }}
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
