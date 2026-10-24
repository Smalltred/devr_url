/**
 * 北京时间换算：存储 UTC、展示/分桶用 UTC+8。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    chinaDateString,
    chinaDateTime,
    chinaTodayAnchor,
    utcToChinaDateTime,
} from '../src/support/chinaTime.js'

describe('北京时间换算', () => {
    it('UTC 时间串转北京时间（含跨日）', () => {
        assert.equal(utcToChinaDateTime('2026-10-23 15:59:59'), '2026-10-23 23:59:59')
        assert.equal(utcToChinaDateTime('2026-10-23 16:00:00'), '2026-10-24 00:00:00')
        assert.equal(utcToChinaDateTime(null), null)
        assert.equal(utcToChinaDateTime(''), null)
    })

    it('日期键按北京时间跨日', () => {
        assert.equal(chinaDateString(new Date('2026-10-23T15:59:59Z')), '2026-10-23')
        assert.equal(chinaDateString(new Date('2026-10-23T16:00:00Z')), '2026-10-24')
    })

    it('当天日期锚点表示北京时间当日', () => {
        assert.equal(chinaTodayAnchor(new Date('2026-10-23T16:00:00Z')), Date.UTC(2026, 9, 24))
    })

    it('chinaDateTime 输出固定格式', () => {
        assert.equal(chinaDateTime(Date.UTC(2026, 9, 23, 16, 0, 0)), '2026-10-24 00:00:00')
    })
})
