/*
 * 测试资源：边界情况 - 极简组件
 */

@Component
struct NoViewTreeComponent {
    // 没有 @Entry，不是入口组件
    // 只有一个简单的 build 方法
    
    build() {
        Text('Simple')
    }
}
