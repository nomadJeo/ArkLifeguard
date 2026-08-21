/*
 * 测试资源：复杂 UI 交互场景
 * 用于测试多种 UI 事件类型和嵌套组件
 */

import router from '@ohos.router';

@Entry
@Component
struct HomePage {
    @State count: number = 0;
    @State message: string = 'Hello';
    @State isLoading: boolean = false;
    @State inputText: string = '';

    // 生命周期方法
    aboutToAppear(): void {
        console.log('HomePage aboutToAppear');
        this.loadData();
    }

    aboutToDisappear(): void {
        console.log('HomePage aboutToDisappear');
    }

    onPageShow(): void {
        console.log('HomePage onPageShow');
    }

    onPageHide(): void {
        console.log('HomePage onPageHide');
    }

    // 业务方法
    loadData(): void {
        this.isLoading = true;
        // 模拟异步加载
        setTimeout(() => {
            this.isLoading = false;
        }, 1000);
    }

    // onClick 回调 - 方法引用形式
    handleButtonClick(): void {
        this.count++;
        console.log('Button clicked, count:', this.count);
    }

    // onTouch 回调 - 处理触摸事件
    handleTouch(event: TouchEvent): void {
        console.log('Touch event:', event.type);
        if (event.type === TouchType.Down) {
            this.message = 'Touched!';
        }
    }

    // onChange 回调 - 处理输入变化
    handleInputChange(value: string): void {
        this.inputText = value;
        console.log('Input changed:', value);
    }

    // 导航方法
    goToDetail(): void {
        router.pushUrl({
            url: 'pages/DetailPage',
            params: { id: this.count }
        });
    }

    goToSettings(): void {
        let options = {
            url: 'pages/SettingsPage'
        };
        router.pushUrl(options);
    }

    build() {
        Column() {
            // 文本显示
            Text(this.message)
                .fontSize(24)
                .fontWeight(FontWeight.Bold)
                .onClick(() => {
                    this.message = 'Text clicked!';
                })

            // 计数器显示
            Text(`Count: ${this.count}`)
                .fontSize(20)

            // 按钮 - 方法引用
            Button('Add Count')
                .onClick(this.handleButtonClick)
                .margin(10)

            // 按钮 - 箭头函数
            Button('Reset')
                .onClick(() => {
                    this.count = 0;
                    this.message = 'Reset!';
                })
                .margin(10)

            // 触摸区域
            Row() {
                Text('Touch Area')
            }
            .width('100%')
            .height(100)
            .backgroundColor('#f0f0f0')
            .onTouch(this.handleTouch)

            // 输入框
            TextInput({ placeholder: 'Enter text...' })
                .onChange(this.handleInputChange)
                .margin(10)

            // 导航按钮
            Button('Go to Detail')
                .onClick(() => this.goToDetail())
                .margin(10)

            Button('Go to Settings')
                .onClick(() => this.goToSettings())
                .margin(10)

            // 嵌套子组件
            ChildComponent({ 
                title: 'Child 1',
                onAction: () => {
                    this.count += 10;
                }
            })

            // 条件渲染
            if (this.isLoading) {
                LoadingProgress()
                    .width(50)
                    .height(50)
            }

            // 列表渲染
            ForEach([1, 2, 3], (item: number) => {
                ListItem({ index: item })
            })
        }
        .width('100%')
        .height('100%')
        .onAppear(() => {
            console.log('Column appeared');
        })
        .onDisAppear(() => {
            console.log('Column disappeared');
        })
    }
}

// 子组件
@Component
struct ChildComponent {
    @Prop title: string = '';
    onAction?: () => void;

    aboutToAppear(): void {
        console.log('ChildComponent aboutToAppear:', this.title);
    }

    handleClick(): void {
        console.log('ChildComponent clicked');
        if (this.onAction) {
            this.onAction();
        }
    }

    build() {
        Row() {
            Text(this.title)
                .fontSize(16)
            Button('Action')
                .onClick(this.handleClick)
        }
        .padding(10)
        .backgroundColor('#e0e0e0')
        .margin(5)
    }
}

// 列表项组件
@Component
struct ListItem {
    @Prop index: number = 0;

    build() {
        Row() {
            Text(`Item ${this.index}`)
                .fontSize(14)
        }
        .padding(8)
        .onClick(() => {
            console.log('ListItem clicked:', this.index);
        })
    }
}
