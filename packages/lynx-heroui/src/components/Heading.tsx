import { component, type Define } from '@sigx/lynx';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingProps =
  & Define.Prop<'level', HeadingLevel, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const levelClasses: Record<HeadingLevel, string> = {
  1: 'hero-text-3xl hero-font-bold',
  2: 'hero-text-2xl hero-font-bold',
  3: 'hero-text-xl hero-font-semibold',
  4: 'hero-text-lg hero-font-semibold',
  5: 'hero-text-base hero-font-semibold',
  6: 'hero-text-sm hero-font-semibold',
};

export const Heading = component<HeadingProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = [levelClasses[props.level ?? 2], 'hero-text-base-content'];
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <text class={getClasses()}>{slots.default?.()}</text>;
});
