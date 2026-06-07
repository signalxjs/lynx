import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { Badge } from '../src/components/Badge';
import { Alert } from '../src/components/Alert';
import { Loading } from '../src/components/Loading';
import { Progress } from '../src/components/Progress';
import { Skeleton } from '../src/components/Skeleton';
import { Steps } from '../src/components/Steps';
import { Avatar } from '../src/components/Avatar';

describe('hero Badge', () => {
  it('defaults to solid neutral', () => {
    const cls = render(<Badge>x</Badge>).container.children[0]._class.split(' ');
    expect(cls).toContain('hero-badge');
    expect(cls).toContain('hero-badge-neutral');
  });
  it('composes color, flat variant and size', () => {
    const cls = render(<Badge color="primary" variant="flat" size="lg">x</Badge>).container.children[0]._class.split(' ');
    expect(cls).toContain('hero-badge-primary');
    expect(cls).toContain('hero-badge-flat');
    expect(cls).toContain('hero-badge-lg');
  });
  it('solid adds no variant class', () => {
    const cls = render(<Badge color="info" variant="solid">x</Badge>).container.children[0]._class.split(' ');
    expect(cls).not.toContain('hero-badge-solid');
  });
});

describe('hero Alert', () => {
  it('applies the status color (default info)', () => {
    expect(render(<Alert>hi</Alert>).container.children[0]._class.split(' ')).toContain('hero-alert-info');
    expect(render(<Alert color="error">hi</Alert>).container.children[0]._class.split(' ')).toContain('hero-alert-error');
  });
});

describe('hero Loading', () => {
  it('applies size and color', () => {
    const cls = render(<Loading size="lg" color="success" />).container.children[0]._class.split(' ');
    expect(cls).toContain('hero-loading');
    expect(cls).toContain('hero-loading-lg');
    expect(cls).toContain('hero-loading-success');
  });
});

describe('hero Progress', () => {
  it('clamps the fill width to the value/max ratio', () => {
    const bar = render(<Progress value={30} max={120} />).container.children[0].children[0];
    expect(bar._style.width).toBe('25%');
  });
  it('clamps over-max to 100%', () => {
    const bar = render(<Progress value={200} max={100} />).container.children[0].children[0];
    expect(bar._style.width).toBe('100%');
  });
  it('applies the color class', () => {
    const cls = render(<Progress value={50} color="warning" />).container.children[0]._class.split(' ');
    expect(cls).toContain('hero-progress-warning');
  });
  it('guards a non-positive max (no NaN width)', () => {
    const bar = render(<Progress value={0} max={0} />).container.children[0].children[0];
    expect(bar._style.width).toBe('0%');
  });
});

describe('hero Skeleton', () => {
  it('makes a circle from a single dimension', () => {
    const s = render(<Skeleton circle width={40} />).container.children[0];
    expect(s._style.width).toBe(40);
    expect(s._style.height).toBe(40);
    expect(s._style.borderRadius).toBe(20);
  });
});

describe('hero Steps', () => {
  it('renders steps with colored indicators', () => {
    const { container } = render(
      <Steps>
        <Steps.Step color="primary" content="1" />
        <Steps.Step content="2" />
      </Steps>,
    );
    const group = container.children[0];
    expect(group._class).toContain('hero-steps-horizontal');
    expect(group.children[0]._class).toContain('hero-step-primary');
  });
});

describe('hero Avatar', () => {
  it('renders an image when src is set', () => {
    const { container } = render(<Avatar src="x.png" size="lg" />);
    const inner = container.children[0].children[0];
    expect(inner.children[0].props.src).toBe('x.png');
  });
  it('renders initials placeholder without src', () => {
    const { container } = render(<Avatar placeholder="AE" />);
    expect(container.findByText('AE')).toBeTruthy();
  });
});
