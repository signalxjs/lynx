import { component } from '@sigx/lynx';
import { Col, Loading, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Loading — every animation type, the size ramp and the semantic colours.
 *
 * Loading is a self-animating indicator with no interactive state.
 */
export const loadingDemo: DaisyComponentDemo = {
    id: 'loading',
    title: 'Loading',
    description: 'Spinner / dots / ring / ball / bars / infinity, sizes and colours',
    icon: { set: 'lucide', name: 'loader-circle' },
    sections: [
        {
            title: 'Types',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Col gap={4} align="center"><Loading type="spinner" /><Text class="opacity-60">spinner</Text></Col>
                    <Col gap={4} align="center"><Loading type="dots" /><Text class="opacity-60">dots</Text></Col>
                    <Col gap={4} align="center"><Loading type="ring" /><Text class="opacity-60">ring</Text></Col>
                    <Col gap={4} align="center"><Loading type="ball" /><Text class="opacity-60">ball</Text></Col>
                    <Col gap={4} align="center"><Loading type="bars" /><Text class="opacity-60">bars</Text></Col>
                    <Col gap={4} align="center"><Loading type="infinity" /><Text class="opacity-60">infinity</Text></Col>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Loading type="spinner" size="xs" />
                    <Loading type="spinner" size="sm" />
                    <Loading type="spinner" size="md" />
                    <Loading type="spinner" size="lg" />
                </Row>
            )),
        },
        {
            title: 'Colours',
            Demo: component(() => () => (
                <Row gap={16} align="center" class="flex-wrap">
                    <Loading type="ring" color="primary" />
                    <Loading type="ring" color="secondary" />
                    <Loading type="ring" color="accent" />
                    <Loading type="ring" color="info" />
                    <Loading type="ring" color="success" />
                    <Loading type="ring" color="warning" />
                    <Loading type="ring" color="error" />
                </Row>
            )),
        },
    ],
};
