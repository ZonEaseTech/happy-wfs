import * as React from 'react';
import { PortProxyForm } from '@/components/PortProxyForm';

export default React.memo(function AddPortProxyPage() {
    return <PortProxyForm mode="create" />;
});
