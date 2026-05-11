import { component, compound, type Define } from '@sigx/lynx';

export type ModalProps =
  & Define.Prop<'open', boolean, false>
  & Define.Prop<'onClose', () => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Modal = component<ModalProps>(({ props, slots }) => {
  return () => {
    if (!props.open) return <view style={{ display: 'none' }} />;

    return (
      <view
        class="modal-overlay"
        bindtap={() => { props.onClose?.(); }}
      >
        <view
          class={`modal-box${props.class ? ' ' + props.class : ''}`}
          bindtap={(e: any) => { e?.stopPropagation?.(); }}
        >
          {slots.default?.()}
        </view>
      </view>
    );
  };
});

type ModalHeaderProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const ModalHeader = component<ModalHeaderProps>(({ props, slots }) => {
  return () => (
    <view class={`modal-header${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

type ModalBodyProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const ModalBody = component<ModalBodyProps>(({ props, slots }) => {
  return () => (
    <view class={`modal-body${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

type ModalActionsProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const ModalActions = component<ModalActionsProps>(({ props, slots }) => {
  return () => (
    <view class={`modal-action${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

export const Modal = compound(_Modal, {
  Header: ModalHeader,
  Body: ModalBody,
  Actions: ModalActions,
});
