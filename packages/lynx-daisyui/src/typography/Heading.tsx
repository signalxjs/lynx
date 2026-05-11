import { component, type Define } from '@sigx/lynx';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadingProps =
  & Define.Prop<'level', HeadingLevel, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const levelClasses: Record<HeadingLevel, string> = {
  1: 'text-3xl font-bold',
  2: 'text-2xl font-bold',
  3: 'text-xl font-semibold',
  4: 'text-lg font-semibold',
  5: 'text-base font-semibold',
  6: 'text-sm font-semibold',
};

export const Heading = component<HeadingProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = [levelClasses[props.level ?? 2], 'text-base-content'];
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <text class={getClasses()}>{slots.default?.()}</text>;
});
