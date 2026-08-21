/*
 * 测试资源：边界情况 - 空组件
 * 用于测试无回调、无生命周期方法的组件
 */

@Entry
@Component
struct EmptyComponent {
    build() {
        Column() {
            Text('Empty Component')
        }
    }
}
