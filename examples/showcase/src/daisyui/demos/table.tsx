import { component } from '@sigx/lynx';
import { Col, Table, type TableColumn, type TableRow } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

const cols: TableColumn[] = [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
    { key: 'year', header: 'Year', align: 'right' },
];

const people: TableRow[] = [
    { name: 'Ada Lovelace', role: 'Pioneer', year: 1843 },
    { name: 'Alan Turing', role: 'Theorist', year: 1936 },
    { name: 'Grace Hopper', role: 'Admiral', year: 1952 },
    { name: 'Margaret Hamilton', role: 'Engineer', year: 1969 },
];

// Wide columns (explicit widths) so the horizontal-scroll demo overflows.
const wideCols: TableColumn[] = [
    { key: 'name', header: 'Name', width: 160 },
    { key: 'role', header: 'Role', width: 140 },
    { key: 'dept', header: 'Department', width: 160 },
    { key: 'year', header: 'Year', width: 80, align: 'right' },
];

/**
 * Table — header + body rows from `columns`/`rows`, zebra striping, the size
 * ramp (sm/xs), and a horizontal-scroll container for wide tables.
 */
export const tableDemo: DaisyComponentDemo = {
    id: 'table',
    title: 'Table',
    description: 'Header + body rows, zebra striping, size ramp, horizontal scroll for wide tables',
    icon: { set: 'lucide', name: 'table' },
    sections: [
        {
            title: 'Zebra',
            Demo: component(() => () => (
                <Table columns={cols} rows={people} zebra />
            )),
        },
        {
            title: 'Default',
            Demo: component(() => () => (
                <Table columns={cols} rows={people} />
            )),
        },
        {
            title: 'Sizes',
            note: 'sm and xs tighten the cells',
            Demo: component(() => () => (
                <Col gap={16}>
                    <Table columns={cols} rows={people.slice(0, 2)} size="sm" zebra />
                    <Table columns={cols} rows={people.slice(0, 2)} size="xs" zebra />
                </Col>
            )),
        },
        {
            title: 'Horizontal scroll',
            note: 'wide table — drag sideways',
            Demo: component(() => () => (
                <Table
                    columns={wideCols}
                    rows={people.map((p) => ({ ...p, dept: 'Computing' }))}
                    zebra
                    scrollX
                />
            )),
        },
    ],
};
