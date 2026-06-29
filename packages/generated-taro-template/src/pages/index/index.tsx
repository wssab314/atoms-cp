import { View, Text, Button, ScrollView } from '@tarojs/components';
import './index.css';

export default function Index() {
  return (
    <ScrollView className="page" scrollY>
      <View className="hero" data-ai-id="home.hero">
        <Text className="eyebrow">微信小程序</Text>
        <Text className="title" data-ai-id="home.hero.title">正在准备你的小程序</Text>
        <Text className="lede">平台会把需求转化为可预览、可继续修改的小程序工程。</Text>
        <View className="actions">
          <Button className="primary-action">继续修改</Button>
          <Button className="secondary-action">预览快照</Button>
        </View>
      </View>
    </ScrollView>
  );
}
