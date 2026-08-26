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

import { describe, it, expect, beforeEach } from 'vitest';
import { SourceSinkManager, MethodCallInfo, HARMONYOS_SOURCES, HARMONYOS_SINKS } from '../../src/analysis/resource/SourceSinkManager';
import { SourceDefinition, SinkDefinition } from '../../src/analysis/resource/TaintFact';

describe('SourceSinkManager', () => {
    let manager: SourceSinkManager;

    beforeEach(() => {
        manager = new SourceSinkManager();
    });

    describe('默认规则加载', () => {
        it('应该自动加载 HarmonyOS 默认规则', () => {
            expect(manager.getSourceCount()).toBeGreaterThan(0);
            expect(manager.getSinkCount()).toBeGreaterThan(0);
        });

        it('默认规则应该包含常见的资源 API', () => {
            // 检查 Source
            const avPlayerSource = manager.getSourceById('media.createAVPlayer');
            expect(avPlayerSource).not.toBeNull();
            expect(avPlayerSource?.resourceType).toBe('AVPlayer');

            const fileSource = manager.getSourceById('fs.open');
            expect(fileSource).not.toBeNull();
            expect(fileSource?.resourceType).toBe('File');

            // 检查 Sink
            const avPlayerSink = manager.getSinkById('AVPlayer.release');
            expect(avPlayerSink).not.toBeNull();

            const fileSink = manager.getSinkById('fs.close');
            expect(fileSink).not.toBeNull();
        });
    });

    describe('Source 匹配', () => {
        it('应该匹配 media.createAVPlayer', () => {
            const callInfo: MethodCallInfo = {
                className: 'media',
                methodName: 'createAVPlayer',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('media.createAVPlayer');
            expect(source?.resourceType).toBe('AVPlayer');
            expect(source?.returnTainted).toBe(true);
        });

        it('应该匹配 fs.open', () => {
            const callInfo: MethodCallInfo = {
                className: 'fs',
                methodName: 'open',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('fs.open');
            expect(source?.resourceType).toBe('File');
        });

        it('应该匹配 http.createHttp', () => {
            const callInfo: MethodCallInfo = {
                className: 'http',
                methodName: 'createHttp',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.resourceType).toBe('HttpRequest');
        });

        it('应该匹配数据库查询', () => {
            const callInfo: MethodCallInfo = {
                className: 'RdbStore',
                methodName: 'query',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.resourceType).toBe('ResultSet');
        });

        it('应该匹配 dataRdb.getRdbStore（import dataRdb from relationalStore）', () => {
            const callInfo: MethodCallInfo = {
                className: 'dataRdb',
                methodName: 'getRdbStore',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('dataRdb.getRdbStore');
            expect(source?.resourceType).toBe('RdbStore');
        });

        it('应该匹配 rdb.getRdbStore（import rdb from relationalStore）', () => {
            const callInfo: MethodCallInfo = {
                className: 'rdb',
                methodName: 'getRdbStore',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('rdb.getRdbStore');
            expect(source?.resourceType).toBe('RdbStore');
        });

        it('应该通过 openSync.fallback 匹配任意别名的 openSync', () => {
            const callInfo: MethodCallInfo = {
                className: 'fileUtil',
                methodName: 'openSync',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('openSync.fallback');
            expect(source?.resourceType).toBe('File');
        });

        it('应该匹配 fileIo.openSync（@kit.CoreFileKit）', () => {
            const callInfo: MethodCallInfo = {
                className: 'fileIo',
                methodName: 'openSync',
            };

            const source = manager.isSource(callInfo);

            expect(source).not.toBeNull();
            expect(source?.id).toBe('fileIo.openSync');
        });

        it('未知方法不应该匹配', () => {
            const callInfo: MethodCallInfo = {
                className: 'unknown',
                methodName: 'unknownMethod',
            };

            const source = manager.isSource(callInfo);

            expect(source).toBeNull();
        });
    });

    describe('Sink 匹配', () => {
        it('应该匹配 AVPlayer.release', () => {
            const callInfo: MethodCallInfo = {
                className: 'AVPlayer',
                methodName: 'release',
            };

            const sink = manager.isSink(callInfo);

            expect(sink).not.toBeNull();
            expect(sink?.id).toBe('AVPlayer.release');
            expect(sink?.requireTaintedThis).toBe(true);
        });

        it('应该匹配 fs.close', () => {
            const callInfo: MethodCallInfo = {
                className: 'fs',
                methodName: 'close',
            };

            const sink = manager.isSink(callInfo);

            expect(sink).not.toBeNull();
            expect(sink?.id).toBe('fs.close');
            expect(sink?.requiredTaintedParamIndices).toContain(0);
        });

        it('应该匹配 HttpRequest.destroy', () => {
            const callInfo: MethodCallInfo = {
                className: 'HttpRequest',
                methodName: 'destroy',
            };

            const sink = manager.isSink(callInfo);

            expect(sink).not.toBeNull();
            expect(sink?.requireTaintedThis).toBe(true);
        });

        it('未知方法不应该匹配', () => {
            const callInfo: MethodCallInfo = {
                className: 'unknown',
                methodName: 'unknownMethod',
            };

            const sink = manager.isSink(callInfo);

            expect(sink).toBeNull();
        });
    });

    describe('Source-Sink 配对', () => {
        it('AVPlayer 的 Source 和 Sink 应该配对', () => {
            const source = manager.getSourceById('media.createAVPlayer');
            expect(source).not.toBeNull();

            const pairedSink = manager.getPairedSink(source!);
            expect(pairedSink).not.toBeNull();
            expect(pairedSink?.id).toBe('AVPlayer.release');
        });

        it('File 的 Source 和 Sink 应该配对', () => {
            const source = manager.getSourceById('fs.open');
            expect(source).not.toBeNull();

            const pairedSink = manager.getPairedSink(source!);
            expect(pairedSink).not.toBeNull();
            expect(pairedSink?.id).toBe('fs.close');
        });

        it('HttpRequest 的 Sink 应该能找到配对的 Source', () => {
            const sink = manager.getSinkById('HttpRequest.destroy');
            expect(sink).not.toBeNull();

            const pairedSource = manager.getPairedSource(sink!);
            expect(pairedSource).not.toBeNull();
            expect(pairedSource?.id).toBe('http.createHttp');
        });
    });

    describe('自定义规则注册', () => {
        it('应该能注册自定义 Source', () => {
            const customSource: SourceDefinition = {
                id: 'custom.createResource',
                methodPattern: 'CustomClass.createResource',
                category: 'resource',
                resourceType: 'CustomResource',
                returnTainted: true,
                taintedParamIndices: [],
            };

            manager.registerSource(customSource);

            const callInfo: MethodCallInfo = {
                className: 'CustomClass',
                methodName: 'createResource',
            };

            const source = manager.isSource(callInfo);
            expect(source).not.toBeNull();
            expect(source?.id).toBe('custom.createResource');
        });

        it('应该能注册自定义 Sink', () => {
            // 默认规则包含宽松的 release fallback；清空后单独验证自定义注册。
            manager.clearRules();
            const customSink: SinkDefinition = {
                id: 'custom.releaseResource',
                methodPattern: 'CustomResource.release',
                category: 'resource_release',
                requiredTaintedParamIndices: [],
                requireTaintedThis: true,
            };

            manager.registerSink(customSink);

            const callInfo: MethodCallInfo = {
                className: 'CustomResource',
                methodName: 'release',
            };

            const sink = manager.isSink(callInfo);
            expect(sink).not.toBeNull();
            expect(sink?.id).toBe('custom.releaseResource');
        });
    });

    describe('规则管理', () => {
        it('clearRules 应该清除所有规则', () => {
            expect(manager.getSourceCount()).toBeGreaterThan(0);

            manager.clearRules();

            expect(manager.getSourceCount()).toBe(0);
            expect(manager.getSinkCount()).toBe(0);
        });

        it('reloadDefaultRules 应该重新加载默认规则', () => {
            manager.clearRules();
            expect(manager.getSourceCount()).toBe(0);

            manager.reloadDefaultRules();

            expect(manager.getSourceCount()).toBeGreaterThan(0);
            expect(manager.getSinkCount()).toBeGreaterThan(0);
        });

        it('getAllSources 应该返回所有 Source', () => {
            const sources = manager.getAllSources();

            expect(sources.length).toBe(manager.getSourceCount());
            expect(sources.some(s => s.resourceType === 'AVPlayer')).toBe(true);
        });

        it('getAllSinks 应该返回所有 Sink', () => {
            const sinks = manager.getAllSinks();

            expect(sinks.length).toBe(manager.getSinkCount());
            expect(sinks.some(s => s.id === 'AVPlayer.release')).toBe(true);
        });

        it('getSourcesByCategory 应该按类别筛选', () => {
            const resourceSources = manager.getSourcesByCategory('resource');

            expect(resourceSources.length).toBeGreaterThan(0);
            expect(resourceSources.every(s => s.category === 'resource')).toBe(true);
        });
    });

    describe('通配符匹配', () => {
        it('应该支持方法名直接匹配', () => {
            // 只提供方法名
            const callInfo: MethodCallInfo = {
                className: '',
                methodName: 'fs.open',
            };

            const source = manager.isSource(callInfo);
            expect(source).not.toBeNull();
        });
    });
});

describe('HARMONYOS_SOURCES', () => {
    it('应该包含多媒体相关的 Source', () => {
        const mediaTypes = ['AVPlayer', 'AVRecorder', 'AudioRenderer', 'AudioCapturer'];

        for (const type of mediaTypes) {
            const found = HARMONYOS_SOURCES.find(s => s.resourceType === type);
            expect(found).toBeDefined();
        }
    });

    it('应该包含文件系统相关的 Source', () => {
        const found = HARMONYOS_SOURCES.find(s => s.resourceType === 'File');
        expect(found).toBeDefined();
    });

    it('应该包含网络相关的 Source', () => {
        const networkTypes = ['HttpRequest', 'TCPSocket', 'UDPSocket', 'WebSocket'];

        for (const type of networkTypes) {
            const found = HARMONYOS_SOURCES.find(s => s.resourceType === type);
            expect(found).toBeDefined();
        }
    });

    it('应该包含数据库相关的 Source', () => {
        const dbTypes = ['RdbStore', 'ResultSet'];

        for (const type of dbTypes) {
            const found = HARMONYOS_SOURCES.find(s => s.resourceType === type);
            expect(found).toBeDefined();
        }
    });

    it('每个 Source 应该有有效的配对 Sink ID', () => {
        const sourcesWithPair = HARMONYOS_SOURCES.filter(s => s.pairedSinkId);

        for (const source of sourcesWithPair) {
            const pairedSink = HARMONYOS_SINKS.find(sink => sink.id === source.pairedSinkId);
            expect(pairedSink).toBeDefined();
        }
    });
});

describe('HARMONYOS_SINKS', () => {
    it('每个需要配对的 Sink 应该有有效的配对 Source ID', () => {
        const sinksWithPair = HARMONYOS_SINKS.filter(s => s.pairedSourceId);

        for (const sink of sinksWithPair) {
            const pairedSource = HARMONYOS_SOURCES.find(source => source.id === sink.pairedSourceId);
            expect(pairedSource).toBeDefined();
        }
    });

    it('释放方法应该正确设置 requireTaintedThis', () => {
        const releaseMethods = HARMONYOS_SINKS.filter(s => s.methodPattern.includes('.release') || s.methodPattern.includes('.destroy'));

        for (const sink of releaseMethods) {
            expect(sink.requireTaintedThis).toBe(true);
        }
    });

    it('文件关闭方法应该要求第一个参数被污染', () => {
        const fileCloseMethods = HARMONYOS_SINKS.filter(s => s.methodPattern.startsWith('fs.close') || s.methodPattern.startsWith('fileio.close'));

        for (const sink of fileCloseMethods) {
            expect(sink.requiredTaintedParamIndices).toContain(0);
        }
    });
});
