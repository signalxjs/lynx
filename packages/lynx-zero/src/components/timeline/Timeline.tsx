/**
 * Timeline — events along an axis, zero's anatomy on lynx.
 *
 * ```tsx
 * <Timeline.Root color="neutral">
 *     <Timeline.Item>
 *         <Timeline.Marker />
 *         <Timeline.Content><text>v1.0 shipped</text></Timeline.Content>
 *         <Timeline.Connector />
 *     </Timeline.Item>
 *     <Timeline.Item>
 *         <Timeline.Marker color="error" />
 *         <Timeline.Content placement="start"><text>v2.0 rolled back</text></Timeline.Content>
 *     </Timeline.Item>
 * </Timeline.Root>
 * ```
 *
 * Vertical by default. Marker and connector are decoration (not accessible
 * elements): the reader gets each event from the content text.
 *
 * The marker RE-CARRIES the colour axis (the anatomy's `carries: ['color']`,
 * signalxjs/zero#94): `color` on the Root colours every marker, `color` on
 * one Marker colours that marker alone. Lynx CSS has no descendant
 * selector, so the nearest provider's value is STAMPED on the marker
 * (`provideCarriedAxes`) — `.zx-timeline__marker.zx-a-color-error` is the
 * same compiled rule whichever element supplied the value. A marker without
 * a colour of its own follows the Root.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideCarriedAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.timeline;

type Orientation = 'horizontal' | 'vertical';

/** Which side of the axis a content box sits on — the logical pair. */
export type TimelinePlacement = 'start' | 'end';

interface TimelineContext {
    orientation(): Orientation;
}

const useTimelineContext = defineInjectable<TimelineContext>(() => ({
    orientation: () => 'vertical',
}));

export type TimelineRootProps =
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TimelineRoot = component<TimelineRootProps>(({ props, slots }) => {
    const orientation = (): Orientation => props.orientation ?? 'vertical';
    const axes = (): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size });
    provideVariantAxes(axes);
    defineProvide(useTimelineContext, () => ({ orientation }));
    return () => (
        <view {...partBag(anatomy, 'root', { orientation: orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Timeline.Root' });

export type TimelinePartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const TimelineItem = component<TimelinePartProps>(({ props, slots }) => {
    const timeline = useTimelineContext();
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'item', { orientation: timeline.orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Timeline.Item' });

/**
 * The marker takes the scope's colour vocabulary for itself, mirroring
 * zero's `TimelineMarkerProps` — its own value outranks the Root's.
 */
export type TimelineMarkerProps = Define.Prop<'color', string, false> & TimelinePartProps;

const TimelineMarker = component<TimelineMarkerProps>(({ props, slots }) => {
    const axes = provideCarriedAxes(anatomy, 'marker', () => ({ color: props.color }));
    return () => (
        <view
            {...partBag(anatomy, 'marker', { ...partAxes(axes()), class: props.class })}
            accessibility-element={false}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Timeline.Marker' });

export type TimelineConnectorProps = Define.Prop<'class', string, false>;

const TimelineConnector = component<TimelineConnectorProps>(({ props }) => {
    const timeline = useTimelineContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'connector', { orientation: timeline.orientation(), ...partAxes(axes()), class: props.class })}
            accessibility-element={false}
        />
    );
}, { name: 'Timeline.Connector' });

export type TimelineContentProps =
    & Define.Prop<'placement', TimelinePlacement, false>
    & TimelinePartProps;

const TimelineContent = component<TimelineContentProps>(({ props, slots }) => {
    const timeline = useTimelineContext();
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'content', {
            placement: props.placement ?? 'end',
            orientation: timeline.orientation(),
            ...partAxes(axes()),
            class: props.class,
        })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Timeline.Content' });

export const Timeline = compound(TimelineRoot, {
    Root: TimelineRoot,
    Item: TimelineItem,
    Marker: TimelineMarker,
    Connector: TimelineConnector,
    Content: TimelineContent,
});
