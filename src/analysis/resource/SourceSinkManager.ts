/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file taint/SourceSinkManager.ts
 * @description Source/Sink 规则管理器
 * 
 * 管理 HarmonyOS 资源 API 的 Source（资源申请点）和 Sink（资源释放点）规则
 */

import { SourceDefinition, SinkDefinition, TaintCategory } from './TaintFact';

// ============================================================================
// 方法匹配器接口
// ============================================================================

/**
 * 方法调用信息接口（用于匹配）
 */
export interface MethodCallInfo {
    /** 类名（如 "media", "AVPlayer"） */
    className: string;
    /** 方法名（如 "createAVPlayer", "release"） */
    methodName: string;
    /** 完整方法签名（可选） */
    fullSignature?: string;
    /** 模块名（如 "@ohos.multimedia.media"） */
    moduleName?: string;
}

// ============================================================================
// SourceSinkManager
// ============================================================================

/**
 * Source/Sink 规则管理器
 * 
 * 负责管理和匹配 HarmonyOS 资源 API 的 Source/Sink 规则
 */
export class SourceSinkManager {
    /**
     * Source 规则映射：规则 ID -> Source 定义
     * 使用 id 作 key 而非 methodPattern，确保同一 pattern 的多条规则（如 resource 与 memory 两类）
     * 不会互相覆盖。
     */
    private sources: Map<string, SourceDefinition> = new Map();

    /**
     * Sink 规则映射：规则 ID -> Sink 定义
     */
    private sinks: Map<string, SinkDefinition> = new Map();

    /** Source ID 索引（与 sources 共用同一 Map，保留此别名以向后兼容） */
    private get sourceById(): Map<string, SourceDefinition> { return this.sources; }

    /** Sink ID 索引（与 sinks 共用同一 Map，保留此别名以向后兼容） */
    private get sinkById(): Map<string, SinkDefinition> { return this.sinks; }
    
    /** 是否已加载默认规则 */
    private defaultRulesLoaded: boolean = false;
    
    constructor() {
        // 默认加载 HarmonyOS 资源规则
        this.loadDefaultRules();
    }
    
    // ========================================================================
    // 规则注册
    // ========================================================================
    
    /**
     * 注册 Source 规则
     */
    registerSource(source: SourceDefinition): void {
        this.sources.set(source.id, source);
    }

    /**
     * 注册 Sink 规则
     */
    registerSink(sink: SinkDefinition): void {
        this.sinks.set(sink.id, sink);
    }
    
    /**
     * 批量注册 Source 规则
     */
    registerSources(sources: SourceDefinition[]): void {
        for (const source of sources) {
            this.registerSource(source);
        }
    }
    
    /**
     * 批量注册 Sink 规则
     */
    registerSinks(sinks: SinkDefinition[]): void {
        for (const sink of sinks) {
            this.registerSink(sink);
        }
    }
    
    // ========================================================================
    // 规则匹配
    // ========================================================================
    
    /**
     * 判断方法调用是否是 Source
     */
    isSource(callInfo: MethodCallInfo): SourceDefinition | null {
        // 生成调用的所有候选 pattern 字符串，用于精确 O(1) 查找
        const patterns = this.generateMatchPatterns(callInfo);
        const patternSet = new Set(patterns);

        // 遍历所有已注册 Source，先尝试精确 pattern 命中
        for (const source of this.sources.values()) {
            if (patternSet.has(source.methodPattern)) {
                return source;
            }
        }

        // 再尝试通配符匹配
        for (const source of this.sources.values()) {
            if (this.matchesPattern(callInfo, source.methodPattern)) {
                return source;
            }
        }

        return null;
    }

    /**
     * 判断方法调用是否是 Sink
     */
    isSink(callInfo: MethodCallInfo): SinkDefinition | null {
        const patterns = this.generateMatchPatterns(callInfo);
        const patternSet = new Set(patterns);

        for (const sink of this.sinks.values()) {
            if (patternSet.has(sink.methodPattern)) {
                return sink;
            }
        }

        for (const sink of this.sinks.values()) {
            if (this.matchesPattern(callInfo, sink.methodPattern)) {
                return sink;
            }
        }

        return null;
    }
    
    /**
     * 根据 ID 获取 Source 定义
     */
    getSourceById(id: string): SourceDefinition | null {
        return this.sourceById.get(id) || null;
    }
    
    /**
     * 根据 ID 获取 Sink 定义
     */
    getSinkById(id: string): SinkDefinition | null {
        return this.sinkById.get(id) || null;
    }
    
    /**
     * 获取与 Source 配对的 Sink
     */
    getPairedSink(source: SourceDefinition): SinkDefinition | null {
        if (source.pairedSinkId) {
            return this.getSinkById(source.pairedSinkId);
        }
        return null;
    }
    
    /**
     * 获取与 Sink 配对的 Source
     */
    getPairedSource(sink: SinkDefinition): SourceDefinition | null {
        if (sink.pairedSourceId) {
            return this.getSourceById(sink.pairedSourceId);
        }
        return null;
    }
    
    // ========================================================================
    // 内部方法
    // ========================================================================
    
    /**
     * 生成多种匹配模式
     */
    private generateMatchPatterns(callInfo: MethodCallInfo): string[] {
        const patterns: string[] = [];
        
        // 完整签名
        if (callInfo.fullSignature) {
            patterns.push(callInfo.fullSignature);
        }
        
        // 类名.方法名
        patterns.push(`${callInfo.className}.${callInfo.methodName}`);
        
        // 仅方法名
        patterns.push(callInfo.methodName);
        
        // 模块名.方法名
        if (callInfo.moduleName) {
            patterns.push(`${callInfo.moduleName}.${callInfo.methodName}`);
            patterns.push(`${callInfo.moduleName}.${callInfo.className}.${callInfo.methodName}`);
        }
        
        return patterns;
    }
    
    /**
     * 检查调用信息是否匹配模式（支持通配符）
     */
    private matchesPattern(callInfo: MethodCallInfo, pattern: string): boolean {
        // 简单通配符支持：* 匹配任意字符
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        
        // 尝试匹配多种形式
        const candidates = [
            `${callInfo.className}.${callInfo.methodName}`,
            callInfo.methodName,
            callInfo.fullSignature || '',
        ];
        
        if (callInfo.moduleName) {
            candidates.push(`${callInfo.moduleName}.${callInfo.methodName}`);
            candidates.push(`${callInfo.moduleName}.${callInfo.className}.${callInfo.methodName}`);
        }
        
        return candidates.some(c => regex.test(c));
    }
    
    // ========================================================================
    // 默认 HarmonyOS 资源规则
    // ========================================================================
    
    /**
     * 加载默认的 HarmonyOS 资源 API 规则
     */
    loadDefaultRules(): void {
        if (this.defaultRulesLoaded) return;
        
        this.registerSources(HARMONYOS_SOURCES);
        this.registerSinks(HARMONYOS_SINKS);
        
        this.defaultRulesLoaded = true;
    }
    
    /**
     * 清除所有规则
     */
    clearRules(): void {
        this.sources.clear();
        this.sinks.clear();
        this.sourceById.clear();
        this.sinkById.clear();
        this.defaultRulesLoaded = false;
    }
    
    /**
     * 重新加载默认规则
     */
    reloadDefaultRules(): void {
        this.clearRules();
        this.loadDefaultRules();
    }
    
    // ========================================================================
    // 统计信息
    // ========================================================================
    
    /**
     * 获取已注册的 Source 数量
     */
    getSourceCount(): number {
        return this.sources.size;
    }
    
    /**
     * 获取已注册的 Sink 数量
     */
    getSinkCount(): number {
        return this.sinks.size;
    }
    
    /**
     * 获取所有 Source 定义
     */
    getAllSources(): SourceDefinition[] {
        return Array.from(this.sources.values());
    }
    
    /**
     * 获取所有 Sink 定义
     */
    getAllSinks(): SinkDefinition[] {
        return Array.from(this.sinks.values());
    }
    
    /**
     * 按类别获取 Source 定义
     */
    getSourcesByCategory(category: TaintCategory): SourceDefinition[] {
        return this.getAllSources().filter(s => s.category === category);
    }
}

// ============================================================================
// HarmonyOS 默认资源规则
// ============================================================================

/**
 * HarmonyOS 资源申请点（Source）
 * 
 * 参考文档：
 * - https://developer.huawei.com/consumer/cn/doc/harmonyos-references
 */
const HARMONYOS_SOURCES: SourceDefinition[] = [
    // ========================================================================
    // 多媒体 - AVPlayer
    // ========================================================================
    {
        id: 'media.createAVPlayer',
        methodPattern: 'media.createAVPlayer',
        category: 'resource',
        resourceType: 'AVPlayer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AVPlayer.release',
        description: '创建音视频播放器实例',
    },
    {
        id: 'createAVPlayer.fallback',
        methodPattern: 'createAVPlayer',
        category: 'resource',
        resourceType: 'AVPlayer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AVPlayer.release',
        description: '创建音视频播放器实例（宽松匹配，className 未知时回退）',
    },
    {
        id: 'media.createAVRecorder',
        methodPattern: 'media.createAVRecorder',
        category: 'resource',
        resourceType: 'AVRecorder',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AVRecorder.release',
        description: '创建音视频录制器实例',
    },
    {
        id: 'media.createVideoPlayer',
        methodPattern: 'media.createVideoPlayer',
        category: 'resource',
        resourceType: 'VideoPlayer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'VideoPlayer.release',
        description: '创建视频播放器实例（已废弃，推荐使用AVPlayer）',
    },
    {
        id: 'media.createAudioPlayer',
        methodPattern: 'media.createAudioPlayer',
        category: 'resource',
        resourceType: 'AudioPlayer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AudioPlayer.release',
        description: '创建音频播放器实例（已废弃，推荐使用AVPlayer）',
    },
    
    // ========================================================================
    // 多媒体 - 音频
    // ========================================================================
    {
        id: 'audio.createAudioRenderer',
        methodPattern: 'audio.createAudioRenderer',
        category: 'resource',
        resourceType: 'AudioRenderer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AudioRenderer.release',
        description: '创建音频渲染器',
    },
    {
        id: 'audio.createAudioCapturer',
        methodPattern: 'audio.createAudioCapturer',
        category: 'resource',
        resourceType: 'AudioCapturer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'AudioCapturer.release',
        description: '创建音频采集器',
    },
    {
        id: 'audio.createTonePlayer',
        methodPattern: 'audio.createTonePlayer',
        category: 'resource',
        resourceType: 'TonePlayer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'TonePlayer.release',
        description: '创建音调播放器',
    },
    
    // ========================================================================
    // 多媒体 - 图像
    // ========================================================================
    {
        id: 'image.createImageSource',
        methodPattern: 'image.createImageSource',
        category: 'resource',
        resourceType: 'ImageSource',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ImageSource.release',
        description: '创建图片源',
    },
    {
        id: 'image.createImagePacker',
        methodPattern: 'image.createImagePacker',
        category: 'resource',
        resourceType: 'ImagePacker',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ImagePacker.release',
        description: '创建图片打包器',
    },
    {
        id: 'image.createPixelMap',
        methodPattern: 'image.createPixelMap',
        category: 'resource',
        resourceType: 'PixelMap',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'PixelMap.release',
        description: '创建像素图',
    },
    {
        id: 'ImageSource.createPixelMap',
        methodPattern: 'ImageSource.createPixelMap',
        category: 'resource',
        resourceType: 'PixelMap',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'PixelMap.release',
        description: '从图片源创建像素图',
    },
    
    // ========================================================================
    // 文件系统
    // ========================================================================
    {
        id: 'fs.open',
        methodPattern: 'fs.open',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fs.close',
        description: '打开文件',
    },
    {
        id: 'fs.openSync',
        methodPattern: 'fs.openSync',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fs.closeSync',
        description: '同步打开文件',
    },
    {
        id: 'fileio.open',
        methodPattern: 'fileio.open',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fileio.close',
        description: '打开文件（旧 API）',
    },
    {
        id: 'fileio.openSync',
        methodPattern: 'fileio.openSync',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fileio.closeSync',
        description: '同步打开文件（旧 API）',
    },
    {
        id: 'fileIo.open',
        methodPattern: 'fileIo.open',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fileIo.close',
        description: '打开文件（@kit.CoreFileKit fileIo as fs）',
    },
    {
        id: 'fileIo.openSync',
        methodPattern: 'fileIo.openSync',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fileIo.closeSync',
        description: '同步打开文件（@kit.CoreFileKit fileIo as fs）',
    },
    {
        id: 'openSync.fallback',
        methodPattern: 'openSync',
        category: 'resource',
        resourceType: 'File',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'fs.closeSync',
        description: '同步打开文件（宽松匹配：className 可能为 fs/fileIo/fileio 等别名）',
    },
    
    // ========================================================================
    // 网络
    // ========================================================================
    {
        id: 'http.createHttp',
        methodPattern: 'http.createHttp',
        category: 'resource',
        resourceType: 'HttpRequest',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'HttpRequest.destroy',
        description: '创建 HTTP 请求对象',
    },
    {
        id: 'socket.constructTCPSocketInstance',
        methodPattern: 'socket.constructTCPSocketInstance',
        category: 'resource',
        resourceType: 'TCPSocket',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'TCPSocket.close',
        description: '创建 TCP Socket',
    },
    {
        id: 'socket.constructUDPSocketInstance',
        methodPattern: 'socket.constructUDPSocketInstance',
        category: 'resource',
        resourceType: 'UDPSocket',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'UDPSocket.close',
        description: '创建 UDP Socket',
    },
    {
        id: 'webSocket.createWebSocket',
        methodPattern: 'webSocket.createWebSocket',
        category: 'resource',
        resourceType: 'WebSocket',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'WebSocket.close',
        description: '创建 WebSocket 连接',
    },
    
    // ========================================================================
    // 数据库
    // ========================================================================
    {
        id: 'relationalStore.getRdbStore',
        methodPattern: 'relationalStore.getRdbStore',
        category: 'resource',
        resourceType: 'RdbStore',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'RdbStore.close',
        description: '获取关系型数据库存储',
    },
    {
        id: 'data_rdb.getRdbStore',
        methodPattern: 'data_rdb.getRdbStore',
        category: 'resource',
        resourceType: 'RdbStore',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'RdbStore.close',
        description: '获取关系型数据库存储（旧 API）',
    },
    {
        id: 'dataRdb.getRdbStore',
        methodPattern: 'dataRdb.getRdbStore',
        category: 'resource',
        resourceType: 'RdbStore',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'RdbStore.close',
        description: '获取关系型数据库存储（import dataRdb from relationalStore）',
    },
    {
        id: 'rdb.getRdbStore',
        methodPattern: 'rdb.getRdbStore',
        category: 'resource',
        resourceType: 'RdbStore',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'RdbStore.close',
        description: '获取关系型数据库存储（import rdb from relationalStore）',
    },
    {
        id: 'getRdbStore.fallback',
        methodPattern: 'getRdbStore',
        category: 'resource',
        resourceType: 'RdbStore',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'RdbStore.close',
        description: '获取关系型数据库存储（宽松匹配：className 可能为 dataRdb/relationalStore 等）',
    },
    {
        id: 'RdbStore.query',
        methodPattern: 'RdbStore.query',
        category: 'resource',
        resourceType: 'ResultSet',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ResultSet.close',
        description: '数据库查询返回结果集',
    },
    {
        id: 'RdbStore.querySql',
        methodPattern: 'RdbStore.querySql',
        category: 'resource',
        resourceType: 'ResultSet',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ResultSet.close',
        description: 'SQL 查询返回结果集',
    },
    {
        id: 'RdbStore.queryDataSync',
        methodPattern: 'queryDataSync',
        category: 'resource',
        resourceType: 'ResultSet',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ResultSet.close',
        description: '同步数据库查询返回结果集（relationalStore.queryDataSync）',
    },
    
    // ========================================================================
    // 后台任务
    // ========================================================================
    {
        id: 'backgroundTaskManager.requestSuspendDelay',
        methodPattern: 'backgroundTaskManager.requestSuspendDelay',
        category: 'resource',
        resourceType: 'DelaySuspendInfo',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'backgroundTaskManager.cancelSuspendDelay',
        description: '申请延迟挂起',
    },
    {
        id: 'workScheduler.startWork',
        methodPattern: 'workScheduler.startWork',
        category: 'resource',
        resourceType: 'WorkInfo',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'workScheduler.stopWork',
        description: '启动延迟任务',
    },
    
    // ========================================================================
    // 相机
    // ========================================================================
    {
        id: 'camera.getCameraManager',
        methodPattern: 'camera.getCameraManager',
        category: 'resource',
        resourceType: 'CameraManager',
        returnTainted: true,
        taintedParamIndices: [],
        description: '获取相机管理器',
    },
    {
        id: 'CameraManager.createCaptureSession',
        methodPattern: 'CameraManager.createCaptureSession',
        category: 'resource',
        resourceType: 'CaptureSession',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'CaptureSession.release',
        description: '创建拍照会话',
    },
    {
        id: 'CameraManager.createCameraInput',
        methodPattern: 'CameraManager.createCameraInput',
        category: 'resource',
        resourceType: 'CameraInput',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'CameraInput.release',
        description: '创建相机输入',
    },
    
    // ========================================================================
    // 传感器
    // ========================================================================
    {
        id: 'sensor.on',
        methodPattern: 'sensor.on',
        category: 'resource',
        resourceType: 'SensorSubscription',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'sensor.off',
        description: '订阅传感器数据',
    },
    
    // ========================================================================
    // 定位
    // ========================================================================
    {
        id: 'geoLocationManager.on',
        methodPattern: 'geoLocationManager.on',
        category: 'resource',
        resourceType: 'LocationSubscription',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'geoLocationManager.off',
        description: '订阅位置变化',
    },
    
    // ========================================================================
    // 闭包泄漏 - 定时器
    // ========================================================================
    {
        id: 'setInterval',
        methodPattern: 'setInterval',
        category: 'closure',
        resourceType: 'IntervalTimer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'clearInterval',
        description: '创建定时器（闭包捕获外部变量，不清除则泄漏）',
    },
    {
        id: 'setTimeout',
        methodPattern: 'setTimeout',
        category: 'closure',
        resourceType: 'TimeoutTimer',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'clearTimeout',
        description: '创建延迟定时器（组件销毁前需要清除）',
    },
    
    // ========================================================================
    // 闭包泄漏 - 事件订阅（闭包作为回调被持有）
    // ========================================================================
    {
        id: 'emitter.on',
        methodPattern: 'emitter.on',
        category: 'closure',
        resourceType: 'EventSubscription',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'emitter.off',
        description: '注册事件监听器（闭包被事件中心持有）',
    },
    {
        id: 'EventHub.on',
        methodPattern: 'EventHub.on',
        category: 'closure',
        resourceType: 'EventHubSubscription',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'EventHub.off',
        description: '注册 EventHub 监听器',
    },
    {
        id: 'worker.onmessage',
        methodPattern: '*.onmessage',
        category: 'closure',
        resourceType: 'WorkerCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'worker.terminate',
        description: 'Worker 消息回调（Worker 不终止则闭包不释放）',
    },
    
    // ========================================================================
    // 闭包泄漏 - 观察者/Watcher
    // ========================================================================
    {
        id: 'AbilityContext.on',
        methodPattern: 'AbilityContext.on',
        category: 'closure',
        resourceType: 'AbilityContextCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'AbilityContext.off',
        description: 'Ability 上下文事件监听',
    },
    {
        id: 'WindowStage.on',
        methodPattern: 'WindowStage.on',
        category: 'closure',
        resourceType: 'WindowStageCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'WindowStage.off',
        description: 'WindowStage 事件监听',
    },
    {
        id: 'window.on',
        methodPattern: 'window.on',
        category: 'closure',
        resourceType: 'WindowCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'window.off',
        description: '窗口事件监听',
    },
    {
        id: 'inputMethodController.on',
        methodPattern: 'inputMethodController.on',
        category: 'closure',
        resourceType: 'InputMethodCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'inputMethodController.off',
        description: '输入法事件监听',
    },
    
    // ========================================================================
    // 内存泄漏 - 大对象分配
    // ========================================================================
    {
        id: 'image.createPixelMap.memory',
        methodPattern: 'image.createPixelMap',
        category: 'memory',
        resourceType: 'PixelMapMemory',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'PixelMap.release',
        description: '创建像素图（占用大量内存，需及时释放）',
    },
    {
        id: 'ArrayBuffer.new',
        methodPattern: 'new ArrayBuffer',
        category: 'memory',
        resourceType: 'ArrayBuffer',
        returnTainted: true,
        taintedParamIndices: [],
        description: '分配大块内存缓冲区',
    },
    
    // ========================================================================
    // 内存泄漏 - Worker 线程
    // ========================================================================
    {
        id: 'new.Worker',
        methodPattern: 'new Worker',
        category: 'memory',
        resourceType: 'WorkerThread',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'Worker.terminate',
        description: '创建 Worker 线程（不终止则内存不释放）',
    },
    {
        id: 'worker.ThreadWorker',
        methodPattern: 'new ThreadWorker',
        category: 'memory',
        resourceType: 'ThreadWorker',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'ThreadWorker.terminate',
        description: '创建 ThreadWorker（鸿蒙线程 Worker）',
    },

    // ========================================================================
    // 分布式数据对象（@kit.ArkData / distributedDataObject）
    // 注意：ArkAnalyzer 对静态命名空间导入（如 distributedDataObject.create()）
    // 可能将 className 解析为空字符串，导致 "distributedDataObject.create" 模式无法命中。
    // 作为补充，使用 "DataObject.on" 匹配实例方法（className 通常可正确解析）。
    // ========================================================================
    {
        id: 'distributedDataObject.create',
        methodPattern: 'distributedDataObject.create',
        category: 'resource',
        resourceType: 'DistributedDataObject',
        returnTainted: true,
        taintedParamIndices: [],
        pairedSinkId: 'DataObject.off',
        description: '创建分布式数据对象（需在销毁前调用 off 解注册监听器）',
    },
    {
        id: 'DataObject.on',
        methodPattern: 'DataObject.on',
        category: 'closure',
        resourceType: 'DistributedDataObjectListener',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'DataObject.off',
        description: '注册分布式数据对象事件监听（DataObject 不再使用时需 off）',
    },

    // ========================================================================
    // 显示/折叠屏事件监听（@kit.ArkUI / display）
    // ========================================================================
    {
        id: 'display.on',
        methodPattern: 'display.on',
        category: 'closure',
        resourceType: 'DisplayCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'display.off',
        description: '注册 display 模块事件监听（如 foldStatusChange），需在组件销毁时 off',
    },
    // ========================================================================
    // displaySync 帧回调（@kit.ArkGraphics2D）— 需与 display.on 区分，避免误匹配 setInterval
    // ========================================================================
    {
        id: 'displaySync.on',
        methodPattern: 'displaySync.on',
        category: 'closure',
        resourceType: 'DisplaySyncCallback',
        returnTainted: false,
        taintedParamIndices: [],
        pairedSinkId: 'displaySync.off',
        description: '注册 displaySync 帧回调（如 on("frame")），需在 aboutToDisappear 时 off',
    },

    // ========================================================================
    // 公共事件（CommonEvent）订阅
    // ========================================================================
    {
        id: 'CommonEventManager.subscribe',
        methodPattern: 'subscribe',
        category: 'resource',
        resourceType: 'CommonEventSubscription',
        returnTainted: false,
        taintedParamIndices: [0],
        pairedSinkId: 'CommonEventManager.unsubscribe',
        description: 'CommonEvent 订阅注册（第 0 个参数 subscriber 需被 unsubscribe 释放）',
    },
];

/**
 * HarmonyOS 资源释放点（Sink）
 */
const HARMONYOS_SINKS: SinkDefinition[] = [
    // ========================================================================
    // 多媒体 - AVPlayer
    // ========================================================================
    {
        id: 'AVPlayer.release',
        methodPattern: 'AVPlayer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'media.createAVPlayer',
        description: '释放音视频播放器',
    },
    {
        id: 'AVRecorder.release',
        methodPattern: 'AVRecorder.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'media.createAVRecorder',
        description: '释放音视频录制器',
    },
    {
        id: 'VideoPlayer.release',
        methodPattern: 'VideoPlayer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'media.createVideoPlayer',
        description: '释放视频播放器',
    },
    {
        id: 'AudioPlayer.release',
        methodPattern: 'AudioPlayer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'media.createAudioPlayer',
        description: '释放音频播放器',
    },
    
    // ========================================================================
    // 多媒体 - 音频
    // ========================================================================
    {
        id: 'AudioRenderer.release',
        methodPattern: 'AudioRenderer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'audio.createAudioRenderer',
        description: '释放音频渲染器',
    },
    {
        id: 'AudioCapturer.release',
        methodPattern: 'AudioCapturer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'audio.createAudioCapturer',
        description: '释放音频采集器',
    },
    {
        id: 'TonePlayer.release',
        methodPattern: 'TonePlayer.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'audio.createTonePlayer',
        description: '释放音调播放器',
    },
    
    // ========================================================================
    // 多媒体 - 图像
    // ========================================================================
    {
        id: 'ImageSource.release',
        methodPattern: 'ImageSource.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'image.createImageSource',
        description: '释放图片源',
    },
    {
        id: 'ImagePacker.release',
        methodPattern: 'ImagePacker.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'image.createImagePacker',
        description: '释放图片打包器',
    },
    {
        id: 'PixelMap.release',
        methodPattern: 'PixelMap.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'image.createPixelMap',
        description: '释放像素图',
    },
    
    // ========================================================================
    // 文件系统
    // ========================================================================
    {
        id: 'fs.close',
        methodPattern: 'fs.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fs.open',
        description: '关闭文件',
    },
    {
        id: 'fs.closeSync',
        methodPattern: 'fs.closeSync',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fs.openSync',
        description: '同步关闭文件',
    },
    {
        id: 'fileio.close',
        methodPattern: 'fileio.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fileio.open',
        description: '关闭文件（旧 API）',
    },
    {
        id: 'fileio.closeSync',
        methodPattern: 'fileio.closeSync',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fileio.openSync',
        description: '同步关闭文件（旧 API）',
    },
    {
        id: 'fileIo.close',
        methodPattern: 'fileIo.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fileIo.open',
        description: '关闭文件（@kit.CoreFileKit，fileIo as fs 时 close 调用）',
    },
    {
        id: 'fileIo.closeSync',
        methodPattern: 'fileIo.closeSync',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'fileIo.openSync',
        description: '同步关闭文件（@kit.CoreFileKit，fileIo as fs 时 closeSync 调用）',
    },
    
    // ========================================================================
    // 网络
    // ========================================================================
    {
        id: 'HttpRequest.destroy',
        methodPattern: 'HttpRequest.destroy',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'http.createHttp',
        description: '销毁 HTTP 请求对象',
    },
    {
        id: 'TCPSocket.close',
        methodPattern: 'TCPSocket.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'socket.constructTCPSocketInstance',
        description: '关闭 TCP Socket',
    },
    {
        id: 'UDPSocket.close',
        methodPattern: 'UDPSocket.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'socket.constructUDPSocketInstance',
        description: '关闭 UDP Socket',
    },
    {
        id: 'WebSocket.close',
        methodPattern: 'WebSocket.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'webSocket.createWebSocket',
        description: '关闭 WebSocket 连接',
    },
    
    // ========================================================================
    // 数据库
    // ========================================================================
    {
        id: 'RdbStore.close',
        methodPattern: 'RdbStore.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'relationalStore.getRdbStore',
        description: '关闭数据库连接',
    },
    {
        id: 'ResultSet.close',
        methodPattern: 'ResultSet.close',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'RdbStore.query',
        description: '关闭结果集',
    },
    
    // ========================================================================
    // 后台任务
    // ========================================================================
    {
        id: 'backgroundTaskManager.cancelSuspendDelay',
        methodPattern: 'backgroundTaskManager.cancelSuspendDelay',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'backgroundTaskManager.requestSuspendDelay',
        description: '取消延迟挂起',
    },
    {
        id: 'workScheduler.stopWork',
        methodPattern: 'workScheduler.stopWork',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'workScheduler.startWork',
        description: '停止延迟任务',
    },
    
    // ========================================================================
    // 相机
    // ========================================================================
    {
        id: 'CaptureSession.release',
        methodPattern: 'CaptureSession.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'CameraManager.createCaptureSession',
        description: '释放拍照会话',
    },
    {
        id: 'CameraInput.release',
        methodPattern: 'CameraInput.release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'CameraManager.createCameraInput',
        description: '释放相机输入',
    },
    
    // ========================================================================
    // 传感器
    // ========================================================================
    {
        id: 'sensor.off',
        methodPattern: 'sensor.off',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'sensor.on',
        description: '取消订阅传感器数据',
    },
    
    // ========================================================================
    // 定位
    // ========================================================================
    {
        id: 'geoLocationManager.off',
        methodPattern: 'geoLocationManager.off',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'geoLocationManager.on',
        description: '取消订阅位置变化',
    },
    
    // ========================================================================
    // 闭包泄漏释放 - 定时器
    // ========================================================================
    {
        id: 'clearInterval',
        methodPattern: 'clearInterval',
        category: 'closure_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'setInterval',
        description: '清除定时器',
    },
    {
        id: 'clearTimeout',
        methodPattern: 'clearTimeout',
        category: 'closure_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'setTimeout',
        description: '清除延迟定时器',
    },
    
    // ========================================================================
    // 闭包泄漏释放 - 事件取消订阅
    // ========================================================================
    {
        id: 'emitter.off',
        methodPattern: 'emitter.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'emitter.on',
        description: '取消事件监听器',
    },
    {
        id: 'EventHub.off',
        methodPattern: 'EventHub.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'EventHub.on',
        description: '取消 EventHub 监听器',
    },
    {
        id: 'AbilityContext.off',
        methodPattern: 'AbilityContext.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'AbilityContext.on',
        description: '取消 Ability 上下文事件监听',
    },
    {
        id: 'WindowStage.off',
        methodPattern: 'WindowStage.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'WindowStage.on',
        description: '取消 WindowStage 事件监听',
    },
    {
        id: 'window.off',
        methodPattern: 'window.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'window.on',
        description: '取消窗口事件监听',
    },
    {
        id: 'inputMethodController.off',
        methodPattern: 'inputMethodController.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'inputMethodController.on',
        description: '取消输入法事件监听',
    },
    
    // ========================================================================
    // 内存泄漏释放 - Worker 终止
    // ========================================================================
    {
        id: 'Worker.terminate',
        methodPattern: 'Worker.terminate',
        category: 'memory_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'new.Worker',
        description: '终止 Worker 线程',
    },
    {
        id: 'worker.terminate',
        methodPattern: 'worker.terminate',
        category: 'memory_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'new.Worker',
        description: '终止 Worker（实例方法调用）',
    },
    {
        id: 'ThreadWorker.terminate',
        methodPattern: 'ThreadWorker.terminate',
        category: 'memory_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'worker.ThreadWorker',
        description: '终止 ThreadWorker',
    },

    // ========================================================================
    // 分布式数据对象释放
    // ========================================================================
    {
        id: 'DataObject.off',
        methodPattern: 'DataObject.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'DataObject.on',
        description: '解注册分布式数据对象事件监听器',
    },

    // ========================================================================
    // 显示/折叠屏事件监听释放
    // ========================================================================
    {
        id: 'display.off',
        methodPattern: 'display.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'display.on',
        description: '解注册 display 模块事件监听（如 foldStatusChange）',
    },

    // displaySync 帧回调释放（DisplaySync.off 与 displaySync.on 配对）
    {
        id: 'displaySync.off',
        methodPattern: 'displaySync.off',
        category: 'closure_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: false,
        pairedSourceId: 'displaySync.on',
        description: '解注册 displaySync 帧回调（如 off("frame", callback)）',
    },

    // ========================================================================
    // 公共事件（CommonEvent）取消订阅
    // ========================================================================
    {
        id: 'CommonEventManager.unsubscribe',
        methodPattern: 'unsubscribe',
        category: 'resource_release',
        requiredTaintedParamIndices: [0],
        requireTaintedThis: false,
        pairedSourceId: 'CommonEventManager.subscribe',
        description: 'CommonEvent 取消订阅（第 0 个参数 subscriber 为被释放的污点对象）',
    },

    // ========================================================================
    // 多媒体资源释放（宽松匹配，用于 className 未知的情况）
    // ========================================================================
    {
        id: 'release.fallback',
        methodPattern: 'release',
        category: 'resource_release',
        requiredTaintedParamIndices: [],
        requireTaintedThis: true,
        pairedSourceId: 'media.createAVPlayer',
        description: '释放媒体资源（宽松匹配，this 被污染时生效，覆盖 className 未知的 AVPlayer/AVRecorder 等）',
    },
];

// ============================================================================
// 导出
// ============================================================================

export { HARMONYOS_SOURCES, HARMONYOS_SINKS };
export default SourceSinkManager;
