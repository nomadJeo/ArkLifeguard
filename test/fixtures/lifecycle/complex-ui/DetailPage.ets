/*
 * 测试资源：详情页
 * 用于测试页面间参数传递和返回
 */

import router from '@ohos.router';

@Entry
@Component
struct DetailPage {
    @State itemId: number = 0;
    @State data: string = '';

    aboutToAppear(): void {
        // 获取路由参数
        const params = router.getParams() as Record<string, number>;
        if (params && params.id) {
            this.itemId = params.id;
        }
        console.log('DetailPage aboutToAppear, id:', this.itemId);
    }

    handleBack(): void {
        router.back();
    }

    handleBackWithResult(): void {
        router.back({
            url: 'pages/HomePage',
            params: { result: 'success' }
        });
    }

    build() {
        Column() {
            Text(`Detail Page - ID: ${this.itemId}`)
                .fontSize(24)

            Text(this.data)
                .fontSize(16)

            Button('Back')
                .onClick(this.handleBack)
                .margin(10)

            Button('Back with Result')
                .onClick(() => this.handleBackWithResult())
                .margin(10)
        }
        .width('100%')
        .height('100%')
    }
}
