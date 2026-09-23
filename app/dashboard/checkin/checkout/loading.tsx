import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function CheckoutLoading() {
  return (
    <SkeletonContainer
      className="flex flex-col gap-6"
      label="checkout console"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5 space-y-4">
          <CardHeader className="p-0">
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent className="p-0 space-y-3">
            <Skeleton className="h-11 w-full rounded-md" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>

        <Card className="p-5 space-y-4">
          <CardHeader className="p-0">
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="p-0 space-y-3">
            <div className="flex gap-2">
              <Skeleton className="h-11 flex-1 rounded-md" />
              <Skeleton className="h-11 w-24 rounded-md" />
            </div>
            <Skeleton className="h-4 w-52" />
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center pt-2">
        <Skeleton className="h-4 w-48" />
      </div>
    </SkeletonContainer>
  );
}
