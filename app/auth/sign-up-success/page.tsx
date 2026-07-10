import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                注册成功
              </CardTitle>
              <CardDescription>请检查邮箱并完成确认</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                账号已创建。完成邮箱确认后，你可以登录并将项目、画布和文件保存到
                Supabase。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
