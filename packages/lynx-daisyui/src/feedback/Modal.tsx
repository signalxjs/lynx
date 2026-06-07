import { component, compound, type Define } from '@sigx/lynx';

export type ModalProps =
  & Define.Prop<'open', boolean, false>
  & Define.Prop<'onClose', () => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Modal = component<ModalProps>(({ props, slots }) => {
  return () => {
    // Closed state renders a zero-size, out-of-flow placeholder (not
    // display:none — Lynx can leak unstyled text paint through display:none
    // overlays in some builds; zero-size + absolute is the safer shape, same
    // as StatusBarSync and hero's Modal). The modal content is fully unmounted.
    if (!props.open) {
      return <view style={{ position: 'absolute', width: '0px', height: '0px', opacity: 0 }} />;
    }

    return (
      <view
        class="modal-overlay"
        bindtap={() => { props.onClose?.(); }}
      >
        {/* catchtap (Lynx catchEvent) — there is no e.stopPropagation() in
            this runtime, so the old bindtap guard was a silent no-op and any
            tap inside the box bubbled to the overlay's close handler (#260).
            Inner bindtap handlers (buttons, rows) still fire first; the box
            only stops the bubble from continuing to the overlay. Same fix as
            lynx-emoji's SheetPicker (#254/#258). */}
        <view
          class={`modal-box${props.class ? ' ' + props.class : ''}`}
          catchtap={() => {}}
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
