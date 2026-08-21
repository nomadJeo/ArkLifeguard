/*
 * 测试资源：动态路由参数场景
 * 用于测试 NavigationAnalyzer 对各种动态 URL 的处理能力
 */

import router from '@ohos.router';

@Entry
@Component
struct DynamicRouter {
    @State currentPage: string = 'pages/Home';
    
    // 场景 1: 直接字面量 (最简单)
    goToPage1(): void {
        router.pushUrl({ url: 'pages/Page1' });
    }
    
    // 场景 2: 局部变量对象
    goToPage2(): void {
        let options = { url: 'pages/Page2' };
        router.pushUrl(options);
    }
    
    // 场景 3: 分步赋值
    goToPage3(): void {
        let options: any = {};
        options.url = 'pages/Page3';
        router.pushUrl(options);
    }
    
    // 场景 4: 使用成员变量
    goToPage4(): void {
        router.pushUrl({ url: this.currentPage });
    }
    
    // 场景 5: 字符串拼接
    goToPage5(): void {
        let pageName = 'Page5';
        router.pushUrl({ url: 'pages/' + pageName });
    }
    
    // 场景 6: 条件选择
    goToPage6(isAdmin: boolean): void {
        let url = isAdmin ? 'pages/AdminPage' : 'pages/UserPage';
        router.pushUrl({ url: url });
    }
    
    // 场景 7: 函数返回值
    getTargetUrl(): string {
        return 'pages/Page7';
    }
    
    goToPage7(): void {
        router.pushUrl({ url: this.getTargetUrl() });
    }
    
    // 场景 8: 带参数的跳转
    goToDetail(id: number): void {
        router.pushUrl({
            url: 'pages/Detail',
            params: { itemId: id }
        });
    }

    build() {
        Column() {
            Button('Page 1').onClick(() => this.goToPage1())
            Button('Page 2').onClick(() => this.goToPage2())
            Button('Page 3').onClick(() => this.goToPage3())
            Button('Page 4').onClick(() => this.goToPage4())
            Button('Page 5').onClick(() => this.goToPage5())
            Button('Page 6 Admin').onClick(() => this.goToPage6(true))
            Button('Page 7').onClick(() => this.goToPage7())
            Button('Detail').onClick(() => this.goToDetail(123))
        }
    }
}
