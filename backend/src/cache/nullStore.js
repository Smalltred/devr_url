/**
 * 空缓存驱动：不读不写，所有查询直接穿透数据库。
 * 用于缓存关闭、memcached 不可用的部署形态，保证跳转始终可用。
 */
export class NullStore {
    constructor({ servers = [], ttl = 300, negativeTtl = 30, driver = 'null' } = {}) {
        this.servers = servers
        this.ttl = ttl
        this.negativeTtl = negativeTtl
        this.driver = driver
    }

    async get() {
        return null
    }

    async set() {
        return false
    }

    async delete() {
        return true
    }

    status() {
        return {
            driver: 'null',
            enabled: false,
            available: false,
            servers: this.servers,
            ttl: this.ttl,
            negative_ttl: this.negativeTtl,
        }
    }

    async stats() {
        return { hits: 0, misses: 0, items: 0 }
    }
}
