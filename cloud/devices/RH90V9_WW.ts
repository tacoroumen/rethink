import { type ComponentInfo, type Connection, type Tombstone } from '../homeassistant'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import { Enum } from '@/util/enum'
import RC90U2_WW, { COURSES as RC90U2_COURSES, STATES } from './RC90U2_WW'

// LG RH90V9 heat-pump dryer (EU), modelId "RH90V9_WW". Its status record is RC90U2_WW's byte for byte, so
// only the dial's labels and the controls are its own. Fields and commands were confirmed by operating
// the dryer (panel and LG app over the bridge) while recording the wire traffic next to the LG cloud's
// decoded state, and checked against the model JSON. That JSON's ControlWifi lists start, download, power
// off, pause and wake-up; there is no separate power on. Wake-up (F0 2A 01 00) switches the dryer back on
// only during its standby window after a power off; from fully off it is acknowledged and ignored.

// The dial, named after the cloud's courseDryer24inchBase where RC90U2_WW's labels differ. Refresh only
// appears with a downloaded course such as Deodorization on the dial's download position.
const {
    'Cotton Soft': _cottonSoft,
    Duvet: _duvet,
    'Cool Air': _coolAir,
    'Allergy Care': _allergyCare,
    ...SHARED_COURSES
} = RC90U2_COURSES.toCodes()
const COURSES = Enum.of({
    Refresh: 0x01,
    Towels: 0x02,
    'Bulky Item': 0x04,
    'Cotton+': 0x19,
    ...SHARED_COURSES,
})

// rec[8], indexed as in the model JSON; the cloud reads 3 as TURBO on this model
const ECO_HYBRID = Enum.of({ Eco: 0x01, Normal: 0x02, Turbo: 0x03 })

// What the panel shows when the dial lands on each course. Courses without a dry level report 00.
const COURSE_DEFAULTS: Record<number, { dryLevel: number; ecoHybrid: number }> = {
    0x02: { dryLevel: 0x00, ecoHybrid: 0x03 }, // Towels
    0x04: { dryLevel: 0x00, ecoHybrid: 0x03 }, // Bulky Item
    0x07: { dryLevel: 0x03, ecoHybrid: 0x03 }, // Cotton
    0x19: { dryLevel: 0x03, ecoHybrid: 0x01 }, // Cotton+
    0x06: { dryLevel: 0x03, ecoHybrid: 0x03 }, // Mixed Fabric
    0x05: { dryLevel: 0x03, ecoHybrid: 0x03 }, // Easy Care
    0x08: { dryLevel: 0x00, ecoHybrid: 0x01 }, // Sports Wear
    0x09: { dryLevel: 0x00, ecoHybrid: 0x03 }, // Quick Dry
    0x0a: { dryLevel: 0x00, ecoHybrid: 0x01 }, // Delicate
    0x0b: { dryLevel: 0x00, ecoHybrid: 0x01 }, // Wool
    0x0c: { dryLevel: 0x00, ecoHybrid: 0x01 }, // Rack Dry
    0x0e: { dryLevel: 0x00, ecoHybrid: 0x01 }, // Warm Air
}

// the courses Run programme offers: every dial position
const SET_COURSES = new Enum<string>(
    COURSES.entries.filter(([, code]) => typeof code === 'number' && code in COURSE_DEFAULTS),
)
const DEFAULT = 0xff
const SET_DRY_LEVELS = Enum.of({ Default: DEFAULT, Iron: 0x01, Cupboard: 0x03, Extra: 0x04 })
const SET_ECO_HYBRID = Enum.of({ Default: DEFAULT, Eco: 0x01, Turbo: 0x03 })

// Warm Air runs for a set time in minutes, sent in the start frame's sixth byte. The app offers 30 min
// to 3 h 25 min.
const WARM_AIR = 0x0e
const WARM_AIR_MIN = 30
const WARM_AIR_MAX = 205

// rec[23] holds the course stored in the download slot. 0x6B is the factory slot content, Deodorization.
const DOWNLOADS = Enum.of({ Blanket: 0x67, Deodorization: 0x6b })

// F0 25 03 15 <dry level> <EcoHybrid> <minutes> 00x7 <base course> <download> 00x9, as the LG app sent them.
// Dry level, EcoHybrid and time match the model JSON's SmartCourse defaults for each.
const DOWNLOAD_FRAMES: Record<number, { course: number; dryLevel: number; ecoHybrid: number; minutes: number }> = {
    0x67: { course: 0x04, dryLevel: 0x00, ecoHybrid: 0x03, minutes: 165 }, // Blanket, on Bulky Item
    0x6b: { course: 0x01, dryLevel: 0x00, ecoHybrid: 0x03, minutes: 39 }, // Deodorization, on Refresh
}

const ANTI_CREASE = 0x02 // rec[14]
const REMOTE_START = 0x01 // rec[15]

export default class Device extends RC90U2_WW {
    program = { course: 0x07, dryLevel: DEFAULT, ecoHybrid: DEFAULT, warmAirTime: 60, antiCrease: false }
    last?: Buffer // the latest status record, which resuming repeats the course from

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, meta, true)
    }

    protected courses() {
        return COURSES
    }

    protected ecoHybrid() {
        return ECO_HYBRID
    }

    protected components(): Record<string, ComponentInfo | Tombstone> {
        return allowExtendedType({
            ...super.components(),
            power: {
                platform: 'switch',
                unique_id: '$deviceid-power',
                state_topic: '$this/power',
                command_topic: '$this/power/set',
                name: 'Power',
                icon: 'mdi:tumble-dryer',
            },
            start: {
                platform: 'button',
                unique_id: '$deviceid-start',
                command_topic: '$this/start/set',
                payload_press: '',
                name: 'Start',
                icon: 'mdi:play-circle-outline',
            },
            pause: {
                platform: 'button',
                unique_id: '$deviceid-pause',
                command_topic: '$this/pause/set',
                payload_press: '',
                name: 'Pause',
                icon: 'mdi:pause-circle-outline',
            },
            run_programme: {
                platform: 'button',
                unique_id: '$deviceid-run_programme',
                command_topic: '$this/run_programme/set',
                payload_press: '',
                name: 'Run programme',
                icon: 'mdi:play-box-outline',
            },
            set_course: {
                platform: 'select',
                unique_id: '$deviceid-set_course',
                state_topic: '$this/set_course',
                command_topic: '$this/set_course/set',
                name: 'Set course',
                icon: 'mdi:tune-vertical',
                options: SET_COURSES.options,
                entity_category: 'config',
            },
            set_dry_level: {
                platform: 'select',
                unique_id: '$deviceid-set_dry_level',
                state_topic: '$this/set_dry_level',
                command_topic: '$this/set_dry_level/set',
                name: 'Set dry level',
                icon: 'mdi:water-percent',
                options: SET_DRY_LEVELS.options,
                entity_category: 'config',
            },
            set_eco_hybrid: {
                platform: 'select',
                unique_id: '$deviceid-set_eco_hybrid',
                state_topic: '$this/set_eco_hybrid',
                command_topic: '$this/set_eco_hybrid/set',
                name: 'Set Eco Hybrid',
                icon: 'mdi:leaf',
                options: SET_ECO_HYBRID.options,
                entity_category: 'config',
            },
            set_warm_air_time: {
                platform: 'number',
                unique_id: '$deviceid-set_warm_air_time',
                state_topic: '$this/set_warm_air_time',
                command_topic: '$this/set_warm_air_time/set',
                name: 'Set Warm Air time',
                icon: 'mdi:timer-outline',
                unit_of_measurement: 'min',
                min: WARM_AIR_MIN,
                max: WARM_AIR_MAX,
                step: 1,
                mode: 'box',
                entity_category: 'config',
            },
            set_anti_crease: {
                platform: 'switch',
                unique_id: '$deviceid-set_anti_crease',
                state_topic: '$this/set_anti_crease',
                command_topic: '$this/set_anti_crease/set',
                name: 'Set anti crease',
                icon: 'mdi:iron-outline',
                entity_category: 'config',
            },
            set_downloaded_program: {
                platform: 'select',
                unique_id: '$deviceid-set_downloaded_program',
                state_topic: '$this/set_downloaded_program',
                command_topic: '$this/set_downloaded_program/set',
                name: 'Set downloaded program',
                icon: 'mdi:download',
                options: DOWNLOADS.options,
                entity_category: 'config',
            },
            downloaded_program: {
                platform: 'sensor',
                unique_id: '$deviceid-downloaded_program',
                state_topic: '$this/downloaded_program',
                name: 'Downloaded program',
                icon: 'mdi:download',
            },
            remote_start: {
                platform: 'binary_sensor',
                unique_id: '$deviceid-remote_start',
                state_topic: '$this/remote_start',
                name: 'Remote start',
                icon: 'mdi:play-circle-outline',
            },
        })
    }

    protected processStatus(status: Buffer) {
        super.processStatus(status)
        if (status[1] !== 0x19) return
        const rec = status.subarray(2)
        this.last = rec

        // RC90U2_WW leaves Option2 alone; on this model bit 0 follows Remote Start at the panel
        this.publishProperty('remote_start', rec[15] & REMOTE_START ? 'ON' : 'OFF')
        this.publishProperty('downloaded_program', COURSES.map(rec[23]))
        this.publishProperty('set_downloaded_program', DOWNLOADS.map(rec[23]))
        this.publishProgram()
    }

    publishProgram() {
        this.publishProperty('set_course', SET_COURSES.map(this.program.course))
        this.publishProperty('set_dry_level', SET_DRY_LEVELS.map(this.program.dryLevel))
        this.publishProperty('set_eco_hybrid', SET_ECO_HYBRID.map(this.program.ecoHybrid))
        this.publishProperty('set_warm_air_time', this.program.warmAirTime)
        this.publishProperty('set_anti_crease', this.program.antiCrease ? 'ON' : 'OFF')
    }

    // F0 26 <course> <dry level> <EcoHybrid> <Warm Air minutes> 00 00 00 00 00 <anti crease> 03 00 00 00
    // Picks the course and starts it in one go; the dryer only accepts it with Remote Start enabled.
    runProgramme() {
        const { course, dryLevel, ecoHybrid, warmAirTime, antiCrease } = this.program
        const defaults = COURSE_DEFAULTS[course]
        // courses without a dry level take none, whatever the select says
        const level = defaults.dryLevel === 0 ? 0 : dryLevel === DEFAULT ? defaults.dryLevel : dryLevel
        const mode = ecoHybrid === DEFAULT ? defaults.ecoHybrid : ecoHybrid
        const minutes = course === WARM_AIR ? warmAirTime : 0
        const options = antiCrease ? ANTI_CREASE : 0
        this.send(Buffer.from([0xf0, 0x26, course, level, mode, minutes, 0, 0, 0, 0, 0, options, 0x03, 0, 0, 0]))
    }

    // Same frame as a start, but with the course the dryer is paused on and 01 where a start has 03.
    // Captured from the LG app resuming a paused Wool cycle; the cloud reported RUNNING right after.
    // Anti crease carries over from the paused record, as in the app's frames. The dryer has no command
    // to start what the panel shows, so this only resumes.
    resume() {
        if (!this.last || this.last[0] !== STATES.unmap('Paused')) return
        const [course, dryLevel, ecoHybrid] = [this.last[5], this.last[7], this.last[8]]
        const options = this.last[14] & ANTI_CREASE
        this.send(Buffer.from([0xf0, 0x26, course, dryLevel, ecoHybrid, 0, 0, 0, 0, 0, 0, options, 0x01, 0, 0, 0]))
    }

    // Stores a course in the download slot, which the dial's download position then runs.
    download(id: number) {
        const { course, dryLevel, ecoHybrid, minutes } = DOWNLOAD_FRAMES[id]
        const frame = Buffer.alloc(25)
        frame.set([0xf0, 0x25, 0x03, 0x15, dryLevel, ecoHybrid, minutes])
        frame.set([course, id], 14)
        this.send(frame)
    }

    setProperty(prop: string, mqttValue: string) {
        if (prop === 'power' && mqttValue === 'ON') this.send(Buffer.from('F02A0100', 'hex')) // wake-up
        if (prop === 'power' && mqttValue === 'OFF') this.send(Buffer.from('F024010100', 'hex'))
        if (prop === 'start') this.resume()
        if (prop === 'pause') this.send(Buffer.from('F024040100', 'hex'))
        if (prop === 'run_programme') this.runProgramme()

        const set = (key: 'course' | 'dryLevel' | 'ecoHybrid', value: number | undefined) => {
            if (value !== undefined) this.program[key] = value
            this.publishProgram()
        }
        if (prop === 'set_course') set('course', SET_COURSES.unmap(mqttValue))
        if (prop === 'set_dry_level') set('dryLevel', SET_DRY_LEVELS.unmap(mqttValue))
        if (prop === 'set_eco_hybrid') set('ecoHybrid', SET_ECO_HYBRID.unmap(mqttValue))
        if (prop === 'set_warm_air_time') {
            const minutes = Number(mqttValue)
            if (Number.isInteger(minutes) && minutes >= WARM_AIR_MIN && minutes <= WARM_AIR_MAX) {
                this.program.warmAirTime = minutes
            }
            this.publishProgram()
        }
        if (prop === 'set_anti_crease' && (mqttValue === 'ON' || mqttValue === 'OFF')) {
            this.program.antiCrease = mqttValue === 'ON'
            this.publishProgram()
        }
        if (prop === 'set_downloaded_program') {
            const id = DOWNLOADS.unmap(mqttValue)
            if (id !== undefined) this.download(id)
        }
    }
}
