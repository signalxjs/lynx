import { component, compound, type Define } from '@sigx/lynx';

export type ModalProps =
  & Define.Prop<'open', boolean, false>
  & Define.Prop<'onClose', () => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Modal = component<ModalProps>(({ props, slots }) => {
  return () => {
    // Mount/unmount rather than display:none — Lynx can leak unstyled text
    // paint through display:none overlays (see lynx-display-none caveat).
    if (!props.open) return <view style={{ display: 'none' }} />;
    return (
      <view
        class="hero-modal-overlay"
        bindtap={() => { props.onClose?.(); }}
      >
        <view
          class={`hero-modal-box${props.class ? ' ' + props.class : ''}`}
          bindtap={(e: any) => { e?.stopPropagation?.(); }}
        >
          {slots.default?.()}
        </view>
      </view>
    );
  };
});

type SectionProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const ModalHeader = component<SectionProps>(({ props, slots }) => {
  return () => (
    <view class={`hero-modal-header${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const ModalBody = component<SectionProps>(({ props, slots }) => {
  return () => (
    <view class={`hero-modal-body${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const ModalActions = component<SectionProps>(({ props, slots }) => {
  return () => (
    <view class={`hero-modal-actions${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

export const Modal = compound(_Modal, {
  Header: ModalHeader,
  Body: ModalBody,
  Actions: ModalActions,
});
