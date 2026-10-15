import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/RH90V9_WW'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const META: Metadata = { modelId: 'RH90V9_WW', modelName: 'RH90V9_WW', swVersion: '2.10.123' }

// Real 0xEC frames from a RH90V9 (fw 2.10.123), each paired with the LG cloud's reading in the comment.
// powered on, nothing selected: state INITIAL
const READY = buf(
    'aa3c30ec001900000000000000000000000000000000000000010000006b00001901000000000000000000000000000800000000000000006b0041bb',
)
// dial on Cotton: COTTONNORMAL, DRYLEVEL_CUPBOARD, ECOHYBRID_TURBO, 2:30
const COTTON = buf(
    'aa3c30ec001901003000000a00000102000000000800000000000000006b00001901021e00000700030302000000000800000000000000006b00ddbb',
)
// Cotton, dry level up: DRYLEVEL_EXTRA, 3:00
const COTTON_EXTRA = buf(
    'aa3c30ec001901030000000700040302000000000800200000000000006b00001901030000000700040302000000000800000000000000006b0037bb',
)
// Cotton, dry level down: DRYLEVEL_IRON, 1:50
const COTTON_IRON = buf(
    'aa3c30ec001901030000000700040302000000000800000000000000006b00001901013200000700010302000000000800000000000000006b003abb',
)
// dial on Wool: WOOL, ECOHYBRID_ECO, 0:29
const WOOL = buf(
    'aa3c30ec001901003200000800000102000000000800000000000000006b00001901001d00000b00000102000000000800000000000000006b00d1bb',
)
// Cotton, child lock on: CHILDLOCK_ON
const CHILD_LOCK_ON = buf(
    'aa3c30ec001901021e00000700030302000000000800000000000000006b00001901021e00000700030302000000001800000000000000006b00dfbb',
)
// powered off: POWEROFF
const POWER_OFF = buf(
    'aa3c30ec001901021e00000700030302000000000800000000000000006b00001900000000000000000000000000000000000000010000006b0016bb',
)

// remote start enabled at the panel: REMOTE_START_ON
const REMOTE_START_ON = buf(
    'aa3c30ec001901000000000000000000000000000808000000000000006b00001901000000000000000000000000000809000000000000006b0078bb',
)
// Cotton started from the app: RUNNING, DRY_LV1, 2:30 remaining and initial
const RUNNING_COTTON = buf(
    'aa3c30ec001901000000000000000000000000000809000000000000006b00001902021e021e070003030200000000000b000000010000006b002cbb',
)
// paused from the app: PAUSE
const PAUSED = buf(
    'aa3c30ec001903021e021e070003030200000000080b600000020000006b00001903021e021e070003030200000000080b000000020000006b006dbb',
)
// Wool paused from the app, right before the app resumed it: PAUSE
const PAUSED_WOOL = buf(
    'aa3c30ec001903001d001d0b0000010200000000080b600000020000006b00001903001d001d0b0000010200000000080b000000020000006b007fbb',
)
// Easy Care at Iron, ten minutes in: DRY_LV2, 0:55 remaining of 1:00
const EASY_CARE_DRY_LV2 = buf(
    'aa3c30ec00190200380100050001030200000000000b000015010000006b0000190200370100050001030300000000000b00001c010000006b008abb',
)

// dial on Towels: TOWELS, NO_DRYLEVEL, 2:20
const TOWELS = buf(
    'aa3c30ec00190101140000050003030200000000080a000000000000006b0000190102140000020000030200000000080a000000000000006b003abb',
)
// dial on Bulky Item: BULKYITEM, 2:55
const BULKY_ITEM = buf(
    'aa3c30ec00190102140000020000030200000000080a000000000000006b0000190102370000040000030200000000080a000000000000006b00dabb',
)
// dial on the download position, holding Deodorization: REFRESH, smartCourse DEODORIZATION, 0:39
const DEODORIZATION = buf(
    'aa3c30ec001901010000000e0000010200000000080a000000000000006b0000190100270000010000030400000000080a000000006b00006b0089bb',
)
// right after the app downloaded Blanket: BULKYITEM, downloadedCourse BLANKET, 2:45
const BLANKET = buf(
    'aa3c30ec00190100000000000000000000000000080a000000000000006b00001901022d0000040000030200000000080a0000000067000067009ebb',
)
// anti crease switched on at the panel: ANTICREASE_ON
const ANTI_CREASE_ON = buf(
    'aa3c30ec001901021e0000070003030200000000080a000000000000006b00001901021e00000700030302000000000a0a200000000000006b00e5bb',
)
// and off again: ANTICREASE_OFF
const ANTI_CREASE_OFF = buf(
    'aa3c30ec001901021e0000070003030200000000020a000000000000006b00001901021e0000070003030200000000000a000000000000006b00d5bb',
)
// delay end set at the panel: RESERVATION_ON, reserveTimeHour 3
const DELAY_END_3H = buf(
    'aa3c30ec001901021e0000070003030200000000000a000000000000006b00001901021e0000070003030203000300010a000000000000006b00d0bb',
)
// Warm Air 30 min started from the app: RUNNING, initialTimeMinute 30
const RUNNING_WARM_AIR = buf(
    'aa3c30ec001902001e001e0e0000010200000000000b500000010000006b00001902001e001e0e0000010200000000000b000000010000006b0045bb',
)
// Cotton with anti crease, paused from the app: PAUSE, ANTICREASE_ON
const PAUSED_ANTI_CREASE = buf(
    'aa3c30ec001903021e021e0700030302000000000a0b600000020000006b00001903021e021e0700030302000000000a0b000000020000006b0069bb',
)

// the inner bytes of the one frame the device sent
const sent = (thinq: MockThinq2Device) => {
    assert.equal(thinq.outbox.length, 1)
    const frame = thinq.outbox[0]
    return hex(frame.subarray(2, frame.length - 2)).toLowerCase()
}

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    const props = () => ha.devices[DEVICE_ID].properties
    return { thinq, dev, props }
}

describe('RH90V9_WW', () => {
    test('ready, nothing selected', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', READY)
        assert.equal(props().power, 'ON')
        assert.equal(props().status, 'Ready')
        assert.equal(props().course, 'None')
        assert.equal(props().remaining_time, 0)
        assert.equal(props().child_lock, 'OFF')
    })

    test('Cotton at Cupboard / Turbo', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', COTTON)
        assert.equal(props().course, 'Cotton')
        assert.equal(props().dry_level, 'Cupboard')
        assert.equal(props().eco_hybrid, 'Turbo')
        assert.equal(props().remaining_time, 150)
    })

    test('dry level changes', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', COTTON_EXTRA)
        assert.equal(props().dry_level, 'Extra')
        assert.equal(props().remaining_time, 180)
        thinq.emit('data', COTTON_IRON)
        assert.equal(props().dry_level, 'Iron')
        assert.equal(props().remaining_time, 110)
    })

    test('Wool at Eco', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', WOOL)
        assert.equal(props().course, 'Wool')
        assert.equal(props().eco_hybrid, 'Eco')
        assert.equal(props().remaining_time, 29)
    })

    test('child lock', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', CHILD_LOCK_ON)
        assert.equal(props().child_lock, 'ON')
    })

    test('power off', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', POWER_OFF)
        assert.equal(props().power, 'OFF')
        assert.equal(props().status, 'Off')
    })

    test('asks for its state on connect', () => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META)
        const dev = new DUT(ha.asConnection(), thinq, META)
        dev.start()
        assert.equal(sent(thinq), 'f0ed1121010000001800')
    })

    test('remote start enabled at the panel', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', REMOTE_START_ON)
        assert.equal(props().remote_start, 'ON')
        assert.equal(props().status, 'Ready')
    })

    test('running Cotton started from the app', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', RUNNING_COTTON)
        assert.equal(props().status, 'Running')
        assert.equal(props().phase, 'Drying')
        assert.equal(props().course, 'Cotton')
        assert.equal(props().remaining_time, 150)
        assert.equal(props().initial_time, 150)
    })

    test('second drying stage, counting down', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', EASY_CARE_DRY_LV2)
        assert.equal(props().phase, 'Drying')
        assert.equal(props().course, 'Easy Care')
        assert.equal(props().dry_level, 'Iron')
        assert.equal(props().remaining_time, 55)
        assert.equal(props().initial_time, 60)
    })

    test('Towels and Bulky Item take no dry level', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', TOWELS)
        assert.equal(props().course, 'Towels')
        assert.equal(props().remaining_time, 140)
        thinq.emit('data', BULKY_ITEM)
        assert.equal(props().course, 'Bulky Item')
        assert.equal(props().remaining_time, 175)
    })
    test('download position', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', DEODORIZATION)
        assert.equal(props().course, 'Deodorization')
        assert.equal(props().downloaded_program, 'Deodorization')
        assert.equal(props().remaining_time, 39)
        thinq.emit('data', BLANKET)
        assert.equal(props().course, 'Blanket')
        assert.equal(props().downloaded_program, 'Blanket')
        assert.equal(props().remaining_time, 165)
    })
    test('anti crease', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', ANTI_CREASE_ON)
        assert.equal(props().anti_crease, 'ON')
        thinq.emit('data', ANTI_CREASE_OFF)
        assert.equal(props().anti_crease, 'OFF')
    })
    test('delay end', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', ANTI_CREASE_OFF)
        assert.equal(props().reserve_time, 0)
        assert.equal(props().delay, 'OFF')
        thinq.emit('data', DELAY_END_3H)
        assert.equal(props().reserve_time, 180)
        assert.equal(props().delay, 'ON')
        assert.equal(props().status, 'Ready')
    })
    test('Warm Air 30 min running', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', RUNNING_WARM_AIR)
        assert.equal(props().status, 'Running')
        assert.equal(props().course, 'Warm Air')
        assert.equal(props().initial_time, 30)
        assert.equal(props().remaining_time, 30)
    })

    test('paused', () => {
        const { thinq, props } = makeDevice()
        thinq.emit('data', PAUSED)
        assert.equal(props().status, 'Paused')
    })
})

// Every expected command below is one the LG app sent for the same choice.
describe('RH90V9_WW commands', () => {
    const run = (settings: Record<string, string>, prop: string) => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        for (const [k, v] of Object.entries(settings)) dev.setProperty(k, v)
        dev.setProperty(prop, '')
        return sent(thinq)
    }

    const download = (name: string) => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('set_downloaded_program', name)
        return thinq
    }

    test('Cotton at defaults', () => {
        assert.equal(run({ set_course: 'Cotton' }, 'run_programme'), 'f0260703030000000000000003000000')
    })
    test('Cotton at Iron', () => {
        assert.equal(
            run({ set_course: 'Cotton', set_dry_level: 'Iron' }, 'run_programme'),
            'f0260701030000000000000003000000',
        )
    })
    test('Easy Care at Iron', () => {
        assert.equal(
            run({ set_course: 'Easy Care', set_dry_level: 'Iron' }, 'run_programme'),
            'f0260501030000000000000003000000',
        )
    })
    test('Wool takes no dry level, even when one is selected', () => {
        assert.equal(
            run({ set_course: 'Wool', set_dry_level: 'Extra' }, 'run_programme'),
            'f0260b00010000000000000003000000',
        )
    })
    test('Warm Air 30 min, as the app sent it', () => {
        assert.equal(
            run({ set_course: 'Warm Air', set_warm_air_time: '30' }, 'run_programme'),
            'f0260e00011e00000000000003000000',
        )
    })
    test('Warm Air defaults to 60 min, as the app sent it', () => {
        assert.equal(run({ set_course: 'Warm Air' }, 'run_programme'), 'f0260e00013c00000000000003000000')
    })
    test('Warm Air time outside the app range is ignored', () => {
        assert.equal(
            run({ set_course: 'Warm Air', set_warm_air_time: '206' }, 'run_programme'),
            'f0260e00013c00000000000003000000',
        )
    })
    test('Cotton with anti crease, as the app sent it', () => {
        assert.equal(
            run({ set_course: 'Cotton', set_anti_crease: 'ON' }, 'run_programme'),
            'f0260703030000000000000203000000',
        )
    })
    test('Start resumes with anti crease kept', () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', PAUSED_ANTI_CREASE)
        thinq.resetRecorder()
        dev.setProperty('start', '')
        assert.equal(sent(thinq), 'f0260703030000000000000201000000')
    })
    test('download Blanket, as the app sent it', () => {
        assert.equal(sent(download('Blanket')), 'f02503150003a5000000000000000467000000000000000000')
    })
    test('download Deodorization, as the app sent it', () => {
        assert.equal(sent(download('Deodorization')), 'f025031500032700000000000000016b000000000000000000')
    })

    test('pause', () => {
        assert.equal(run({}, 'pause'), 'f024040100')
    })
    test('power off', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('power', 'OFF')
        assert.equal(sent(thinq), 'f024010100')
    })
    test('power on wakes the dryer', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('power', 'ON')
        assert.equal(sent(thinq), 'f02a0100')
    })
    test('Start resumes the paused course with 01', () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', PAUSED_WOOL)
        thinq.resetRecorder()
        dev.setProperty('start', '')
        assert.equal(sent(thinq), 'f0260b00010000000000000001000000')
    })
    test('Start does nothing unless paused', () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', RUNNING_COTTON)
        thinq.resetRecorder()
        dev.setProperty('start', '')
        assert.equal(thinq.outbox.length, 0)
    })
})
