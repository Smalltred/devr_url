/**
 * 点击采集：来源域名、移动/桌面判定与隐私默认值。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ClickTracker } from '../src/services/clickTracker.js'

describe('点击采集', () => {
    /**
     * @param {Record<string, string>} headers
     */
    function track(headers) {
        const records = []
        const tracker = new ClickTracker(
            { record: (code, context) => records.push({ code, ...context }) },
            { hash: () => 'ip-hash' },
            false,
        )
        tracker.track({ header: (name) => headers[name] ?? null, clientIp: '203.0.113.9' }, 'abc')

        return records[0]
    }

    it('记录微信来源与移动设备（UA 含 Mobile）', () => {
        const record = track({
            referer: 'https://weixin.qq.com/some/page',
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 MicroMessenger/8.0.50',
        })

        assert.equal(record.code, 'abc')
        assert.equal(record.referer_host, 'weixin.qq.com')
        assert.equal(record.device, 'mobile')
        // 默认只存域名，不存可能带查询串密钥的完整 Referer
        assert.equal(record.referer, null)
    })

    it('缺少 Referer 时退回 Origin；用 Sec-CH-UA-Mobile 识别移动端', () => {
        const record = track({
            origin: 'https://qq.com',
            'user-agent': 'Mozilla/5.0 (Linux; Android 14)',
            'sec-ch-ua-mobile': '?1',
        })

        assert.equal(record.referer_host, 'qq.com')
        assert.equal(record.device, 'mobile')
    })

    it('平板 UA 计入移动端，空 UA 记为 unknown', () => {
        assert.equal(track({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }).device, 'mobile')

        const unknown = track({})
        assert.equal(unknown.device, 'unknown')
        assert.equal(unknown.referer_host, null)
    })
})
